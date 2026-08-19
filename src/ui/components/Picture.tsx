/**
 * A card's picture, or the space it will occupy.
 *
 * Always renders the frame at the card's aspect ratio, so a grid filling in one
 * image at a time reflows exactly never — on a phone, a list that shifts under
 * your thumb as pictures land is worse than no pictures.
 */
export const Picture = ({ alt, ready, src }: { alt: string; ready: boolean; src?: string }) => (
  <div className="flex aspect-[488/680] w-full items-center justify-center overflow-hidden rounded-lg bg-raised">
    {ready && src ? (
      <img alt={alt} className="h-full w-full object-cover" src={src} />
    ) : (
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
    )}
  </div>
);
