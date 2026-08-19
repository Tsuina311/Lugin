// Tiny CORS proxy for MTGGoldfish archetype pages.
//
// GitHub Pages can't call Goldfish directly (no CORS), and a service-worker
// proxy still can't read cross-origin HTML in modern browsers (ORB). This worker
// fetches on the server side and returns the page with Access-Control-Allow-Origin.
//
// Deploy once: npx wrangler deploy
// Then set the repository variable VITE_LUGIN_GOLDFISH_PROXY_URL to the worker URL
// (e.g. https://lugin-goldfish.<your-subdomain>.workers.dev).

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return cors(new Response(null, { status: 204 }));
    }
    if (request.method !== 'GET') {
      return cors(new Response('method not allowed', { status: 405 }));
    }

    const target = new URL(request.url).searchParams.get('url');
    if (!target) return cors(new Response('missing url', { status: 400 }));

    let parsed;
    try {
      parsed = new URL(target);
    } catch {
      return cors(new Response('bad url', { status: 400 }));
    }
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'www.mtggoldfish.com') {
      return cors(new Response('host not allowed', { status: 403 }));
    }

    try {
      const upstream = await fetch(parsed.href, {
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'User-Agent':
            'Mozilla/5.0 (compatible; Lugin/1.0; +https://github.com/tsuina311/lugin)',
        },
        redirect: 'follow',
      });
      return cors(
        new Response(upstream.body, {
          status: upstream.status,
          statusText: upstream.statusText,
          headers: {
            'Content-Type': upstream.headers.get('Content-Type') || 'text/html; charset=utf-8',
          },
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'upstream fetch failed';
      return cors(new Response(message, { status: 502 }));
    }
  },
};

const cors = response => {
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.headers.set('Access-Control-Max-Age', '86400');
  return response;
};
