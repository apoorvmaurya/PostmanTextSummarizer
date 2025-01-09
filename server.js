const express = require('express');
const axios = require('axios');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(compression()); // Enable compression
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public', { maxAge: '1h' }));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

const API_TOKEN = process.env.HUGGINGFACE_API_TOKEN;
const SUMMARY_API_URL = 'https://api-inference.huggingface.co/models/facebook/bart-large-cnn';
const TRANSLATION_API_URL = 'https://api-inference.huggingface.co/models/facebook/mbart-large-50-many-to-many-mmt';

const MAX_RETRIES = 3;
const RETRY_DELAY = 5000; // 5 seconds
const TIMEOUT = 30000; // 30 seconds

// Enhanced API query function with timeout and better error handling
async function query(url, payload, retries = 0) {
    try {
        const response = await axios.post(url, payload, {
            headers: {
                'Authorization': `Bearer ${API_TOKEN}`,
                'Content-Type': 'application/json'
            },
            timeout: TIMEOUT
        });
        return response.data;
    } catch (error) {
        if (error.response?.data?.error?.includes('currently loading') && retries < MAX_RETRIES) {
            console.log(`Model is loading. Retry ${retries + 1}/${MAX_RETRIES} in ${RETRY_DELAY/1000}s...`);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            return query(url, payload, retries + 1);
        }
        
        // Enhanced error handling
        const errorMessage = error.response?.data?.error || error.message;
        throw new Error(`API Error: ${errorMessage}`);
    }
}

// Optimized translation function with text chunking for long texts
async function translateText(text, sourceLang, targetLang) {
    // Split long texts into chunks of roughly 1000 characters at sentence boundaries
    const chunks = text.match(/[^.!?]+[.!?]+/g) || [text];
    let currentChunk = '';
    const chunksToTranslate = [];
    
    for (const sentence of chunks) {
        if (currentChunk.length + sentence.length > 1000) {
            chunksToTranslate.push(currentChunk);
            currentChunk = sentence;
        } else {
            currentChunk += sentence;
        }
    }
    if (currentChunk) chunksToTranslate.push(currentChunk);

    // Translate chunks in parallel
    const translations = await Promise.all(
        chunksToTranslate.map(chunk => 
            query(TRANSLATION_API_URL, {
                inputs: chunk.trim(),
                parameters: { src_lang: sourceLang, tgt_lang: targetLang }
            })
        )
    );

    return translations.map(t => t[0].translation_text).join(' ');
}

app.post('/summarize', async (req, res) => {
    const { text, language } = req.body;

    if (!text || text.split(/\s+/).filter(w => w.length > 0).length < 100) {
        return res.status(400).json({ error: 'Please enter at least 100 words.' });
    }

    try {
        let englishText = text;
        let originalLanguage = language;

        // Translate to English if needed
        if (language !== 'English') {
            const langCode = getLanguageCode(language);
            englishText = await translateText(text, langCode, 'en_XX');
        }

        // Summarize the English text
        const summaryResult = await query(SUMMARY_API_URL, {
            inputs: englishText,
            parameters: {
                max_length: Math.min(150, Math.ceil(englishText.split(/\s+/).length * 0.3)),
                min_length: 30,
                do_sample: false,
                num_beams: 4,
                length_penalty: 2.0,
                early_stopping: true
            }
        });

        let summary = summaryResult[0].summary_text;

        // Translate summary back if needed
        if (language !== 'English') {
            const langCode = getLanguageCode(language);
            summary = await translateText(summary, 'en_XX', langCode);
        }

        // Post-process summary
        summary = summary.trim();
        summary = summary.charAt(0).toUpperCase() + summary.slice(1);
        if (!summary.endsWith('.')) summary += '.';

        res.json({ summary, originalLanguage });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ 
            error: 'An error occurred while processing the text.',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

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

function getLanguageCode(language) {
    return languageCodes[language] || 'en_XX';
}

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        error: 'Something broke!',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(100).json({ status: 'OK' });
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});