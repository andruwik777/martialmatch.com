export default {
    async fetch(request) {
      const origin = request.headers.get('Origin');
  
      const allowedOrigins = [
        'https://andruwik777.github.io',
        'http://localhost:8080'
      ];
  
      const allowOrigin = allowedOrigins.includes(origin) ? origin : null;
  
      const url = new URL(request.url);
      const path = url.pathname;
  
      let targetUrl;
      let contentType = 'text/plain';
  
      // HTML endpoints
      if (path === '/pl/events') {
        targetUrl = 'https://raw.githubusercontent.com/andruwik777/martialmatch/master/research/html.pl.events';
        contentType = 'text/html; charset=utf-8';
      }
  
      // pl/events/628-x-superpuchar-polski-bjj-nogi-gi/starting-lists
      else if (path.startsWith('/pl/events/') && path.endsWith('/starting-lists')) {
        const id = path.split('/')[3];
        targetUrl = `https://raw.githubusercontent.com/andruwik777/martialmatch/refs/heads/master/research/html.starting.list`;
        contentType = 'text/html; charset=utf-8';
      }
  
      // JSON endpoint
      // /api/public/events/628/fights
      else if (path.startsWith('/api/public/events/') && path.endsWith('/fights')) {
        const id = path.split('/')[4];
        targetUrl = 'https://raw.githubusercontent.com/andruwik777/martialmatch/refs/heads/master/research/json.przebieg.walk';
        contentType = 'application/json';
      }
  
      // /api/events/723/schedules -- we need itto understand matId-matName binding 
      else if (path.startsWith('/api/events/') && path.endsWith('/schedules')) {
        const id = path.split('/')[3];
        targetUrl = `https://raw.githubusercontent.com/andruwik777/martialmatch/refs/heads/master/research/json.harmonogram`;
        contentType = 'application/json';
      }
  
      else {
        return new Response('Not found', {
          status: 404,
            headers: {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': allowOrigin,
            'Vary': 'Origin'
          }
        });
      }
  
      try {
        const response = await fetch(targetUrl);
  
        if (!response.ok) {
          return new Response('Failed to fetch source', {
            status: 500,
              headers: {
              'Content-Type': contentType,
              'Access-Control-Allow-Origin': allowOrigin,
              'Vary': 'Origin'
            }
          });
        }
  
        const data = await response.text();
  
        return new Response(data, {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': allowOrigin,
            'Vary': 'Origin'
          }
        });
  
      } catch (err) {
        return new Response('Proxy error', {
          status: 500,
            headers: {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': allowOrigin,
            'Vary': 'Origin'
          }
        });
      }
    }
  };
  