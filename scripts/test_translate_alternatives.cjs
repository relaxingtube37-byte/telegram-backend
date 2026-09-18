async function testEndpoints() {
  const text = 'Alejandro Moro Canas meets Jay Clarke in a marquee clash contested on Red clay.';

  // 1. clients5.google.com
  try {
    const url1 = `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=en&tl=fa&q=${encodeURIComponent(text)}`;
    const r1 = await fetch(url1);
    console.log('clients5 status:', r1.status);
    if (r1.ok) {
      const d1 = await r1.json();
      console.log('clients5 result:', d1);
    }
  } catch (e) {
    console.log('clients5 err:', e.message);
  }

  // 2. translate.google.com/m
  try {
    const url2 = `https://translate.google.com/m?sl=en&tl=fa&q=${encodeURIComponent(text)}`;
    const r2 = await fetch(url2, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    console.log('translate.google.com/m status:', r2.status);
    if (r2.ok) {
      const html = await r2.text();
      const match = html.match(/class="result-container">([^<]+)<\/div>/);
      console.log('translate.google.com/m result:', match ? match[1] : 'not found');
    }
  } catch (e) {
    console.log('translate.google.com/m err:', e.message);
  }
}

testEndpoints();
