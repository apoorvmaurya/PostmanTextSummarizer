const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const API_TOKEN = process.env.HUGGINGFACE_API_TOKEN;
const API_URL = 'https://api-inference.huggingface.co/models/google/mt5-base';

const MAX_RETRIES = 5;
const RETRY_DELAY = 10000; // 10 seconds

async function query(payload, retries = 0) {
  try {
    const response = await axios.post(API_URL, payload, {
      headers: {
        'Authorization': `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    return response.data;
  } catch (error) {
    if (error.response && error.response.data.error.includes('currently loading') && retries < MAX_RETRIES) {
      console.log(`Model is loading. Retrying in ${RETRY_DELAY / 1000} seconds...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      return query(payload, retries + 1);
    }
    throw error;
  }
}

app.post('/summarize', async (req, res) => {
  const { text, language } = req.body;

  if (text.split(' ').length < 200) {
    return res.status(400).json({ error: 'Please enter at least 200 words.' });
  }

  try {
    const payload = {
      inputs: `summarize this text in ${language}: ${text}`,
      parameters: {
        max_length: 150,
        min_length: 30,
        do_sample: false,
        num_return_sequences: 1
      }
    };

    const result = await query(payload);

    let summary = result[0].generated_text;

    // Post-process the summary
    summary = summary.replace(/<extra_id_\d+>/g, '');  // Remove any <extra_id_X> tokens
    summary = summary.trim();  // Remove leading/trailing whitespace
    summary = summary.charAt(0).toUpperCase() + summary.slice(1);  // Capitalize first letter
    if (!summary.endsWith('.')) summary += '.';  // Add a period if it's missing

    res.json({ summary });
  } catch (error) {
    console.error('Error:', error.response ? error.response.data : error.message);
    res.status(500).json({ error: 'An error occurred while summarizing the text.' });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});