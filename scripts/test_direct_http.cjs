const http = require('http');

console.log('Sending GET http://127.0.0.1:8080/api/web/tournaments/catalog ...');
const req = http.get('http://127.0.0.1:8080/api/web/tournaments/catalog', (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log('Response Status:', res.statusCode);
    const parsed = JSON.parse(data);
    console.log('Catalog Count:', parsed.length);
    console.log('First 3 items:', parsed.slice(0, 3).map(p => p.name));
  });
});

req.on('error', (e) => {
  console.error('Request error:', e.message);
});
