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
const SUMMARY_API_URL = 'https://api-inference.huggingface.co/models/facebook/bart-large-cnn';
const TRANSLATION_API_URL = 'https://api-inference.huggingface.co/models/facebook/mbart-large-50-many-to-many-mmt';

const MAX_RETRIES = 5;
const RETRY_DELAY = 10000; // 10 seconds

async function query(url, payload, retries = 0) {
  try {
    const response = await axios.post(url, payload, {
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
      return query(url, payload, retries + 1);
    }
    throw error;
  }
}

async function translateText(text, sourceLang, targetLang) {
  const payload = {
    inputs: text,
    parameters: {
      src_lang: sourceLang,
      tgt_lang: targetLang
    }
  };
  const result = await query(TRANSLATION_API_URL, payload);
  return result[0].translation_text;
}

app.post('/summarize', async (req, res) => {
  const { text, language } = req.body;

  if (text.split(' ').length < 200) {
    return res.status(400).json({ error: 'Please enter at least 200 words.' });
  }

  try {
    let englishText = text;
    let originalLanguage = language;

    // Translate to English if not already in English
    if (language !== 'English') {
      const langCode = getLanguageCode(language);
      englishText = await translateText(text, langCode, 'en_XX');
    }

    // Summarize the English text
    const summaryPayload = {
      inputs: englishText,
      parameters: {
        max_length: 150,
        min_length: 30,
        do_sample: false,
      }
    };

    const summaryResult = await query(SUMMARY_API_URL, summaryPayload);
    let summary = summaryResult[0].summary_text;

    // Translate summary back to original language if needed
    if (language !== 'English') {
      const langCode = getLanguageCode(language);
      summary = await translateText(summary, 'en_XX', langCode);
    }

    // Post-process the summary
    summary = summary.trim();
    summary = summary.charAt(0).toUpperCase() + summary.slice(1);
    if (!summary.endsWith('.')) summary += '.';

    res.json({ summary, originalLanguage });
  } catch (error) {
    console.error('Error:', error.response ? error.response.data : error.message);
    res.status(500).json({ error: 'An error occurred while processing the text.' });
  }
});

function getLanguageCode(language) {
  const languageCodes = {
    'English': 'en_XX',
    'Hindi': 'hi_IN',
    'Bengali': 'bn_IN',
    'Telugu': 'te_IN',
    'Tamil': 'ta_IN',
    'Marathi': 'mr_IN',
    'Gujarati': 'gu_IN',
    'Kannada': 'kn_IN',
    'Malayalam': 'ml_IN',
    'Punjabi': 'pa_IN',
    'Odia': 'or_IN',
    'Assamese': 'as_IN',
    'Urdu': 'ur_PK'
  };
  return languageCodes[language] || 'en_XX';
}

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});