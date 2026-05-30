exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  const GROQ_KEY = process.env.GROQ_KEY;
  if (!GROQ_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'API key no configurada' }) };
  }
  try {
    const { audio, mimeType } = JSON.parse(event.body);
    const audioBuffer = Buffer.from(audio, 'base64');
    const audioBlob = new Blob([audioBuffer], { type: mimeType || 'audio/webm' });

    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.webm');
    formData.append('model', 'whisper-large-v3');
    formData.append('language', 'es');
    formData.append('response_format', 'json');

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_KEY}` },
      body: formData
    });
    const data = await response.json();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Error al transcribir' })
    };
  }
};
