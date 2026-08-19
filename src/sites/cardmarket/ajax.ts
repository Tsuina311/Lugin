/**
 * Cardmarket's AJAX endpoints all answer with the same small XML envelope, and
 * every field inside it is base64:
 *
 *   <ajaxResponse><resultType>c3VjY2Vzcw==</resultType>…</ajaxResponse>
 *
 * The payloads are UTF-8, but `atob` hands back one byte per character, so an
 * accented seller name or a card title like "Æther Vial" arrives as mojibake
 * unless the bytes are walked back through `escape`/`decodeURIComponent`. That
 * pair is deprecated and has no modern equivalent that operates on a byte
 * string, which is the only reason it is here.
 */

/** Decode one base64 field of an `<ajaxResponse>`, or '' if it isn't valid. */
export const decodeAjaxChunk = (b64: string): string => {
  const clean = b64.replace(/\s+/g, '');
  if (!clean) return '';
  try {
    return decodeURIComponent(escape(atob(clean)));
  } catch {
    // Not UTF-8 after all — better a readable latin1 string than nothing.
    try {
      return atob(clean);
    } catch {
      return '';
    }
  }
};

/**
 * Pull one named field out of an `<ajaxResponse>` and decode it.
 *
 * Tolerant of whitespace inside the tags, because the envelope is generated and
 * has been seen pretty-printed.
 */
export const ajaxBox = (xml: string, tag: string): string => {
  const match = xml.match(new RegExp(`<${tag}\\s*>([\\s\\S]*?)</${tag}\\s*>`));
  return match ? decodeAjaxChunk(match[1]) : '';
};
