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
const TIMEOUT = 60000; // 60 seconds (increased for better reliability)

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
        // Handle model loading error
        if (error.response?.data?.error?.includes('currently loading') && retries < MAX_RETRIES) {
            console.log(`Model is loading. Retry ${retries + 1}/${MAX_RETRIES} in ${RETRY_DELAY/1000}s...`);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            return query(url, payload, retries + 1);
        }
        
        // Handle rate limiting
        if (error.response?.status === 429 && retries < MAX_RETRIES) {
            console.log(`Rate limited. Retry ${retries + 1}/${MAX_RETRIES} in ${RETRY_DELAY/1000}s...`);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            return query(url, payload, retries + 1);
        }
        
        // Handle network errors
        if ((error.code === 'ECONNRESET' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') && retries < MAX_RETRIES) {
            console.log(`Network error. Retry ${retries + 1}/${MAX_RETRIES} in ${RETRY_DELAY/1000}s...`);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            return query(url, payload, retries + 1);
        }
        
        // Enhanced error handling
        const errorMessage = error.response?.data?.error || error.message || 'Unknown error occurred';
        throw new Error(`API Error: ${errorMessage}`);
    }
}

// Optimized translation function with text chunking for long texts
async function translateText(text, sourceLang, targetLang) {
    if (!text || text.trim().length === 0) {
        throw new Error('No text provided for translation');
    }

    // Split long texts into chunks of roughly 1000 characters at sentence boundaries
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    let currentChunk = '';
    const chunksToTranslate = [];
    
    for (const sentence of sentences) {
        if (currentChunk.length + sentence.length > 1000 && currentChunk.length > 0) {
            chunksToTranslate.push(currentChunk.trim());
            currentChunk = sentence;
        } else {
            currentChunk += sentence;
        }
    }
    if (currentChunk.trim()) {
        chunksToTranslate.push(currentChunk.trim());
    }

    // If no proper chunks, use the original text
    if (chunksToTranslate.length === 0) {
        chunksToTranslate.push(text);
    }

    try {
        // Translate chunks in parallel with error handling
        const translations = await Promise.all(
            chunksToTranslate.map(async (chunk, index) => {
                try {
                    const result = await query(TRANSLATION_API_URL, {
                        inputs: chunk,
                        parameters: { src_lang: sourceLang, tgt_lang: targetLang }
                    });
                    
                    // Handle different response formats
                    if (Array.isArray(result) && result[0] && result[0].translation_text) {
                        return result[0].translation_text;
                    } else if (result.translation_text) {
                        return result.translation_text;
                    } else {
                        console.warn(`Unexpected translation response for chunk ${index}:`, result);
                        return chunk; // Fallback to original text
                    }
                } catch (chunkError) {
                    console.warn(`Translation failed for chunk ${index}, using original:`, chunkError.message);
                    return chunk; // Fallback to original text
                }
            })
        );

        return translations.join(' ').trim();
    } catch (error) {
        console.error('Translation error:', error);
        throw new Error('Translation failed. Please try again.');
    }
}

app.post('/summarize', async (req, res) => {
    try {
        const { text, language } = req.body;

        // Input validation
        if (!text || typeof text !== 'string') {
            return res.status(400).json({ error: 'Please provide valid text input.' });
        }

        if (!language || typeof language !== 'string') {
            return res.status(400).json({ error: 'Please select a language.' });
        }

        const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
        if (wordCount < 100) {
            return res.status(400).json({ error: 'Please enter at least 100 words.' });
        }

        let englishText = text;
        let originalLanguage = language;

        // Translate to English if needed
        if (language !== 'English') {
            const langCode = getLanguageCode(language);
            if (!langCode) {
                return res.status(400).json({ error: 'Unsupported language selected.' });
            }
            
            console.log(`Translating from ${language} to English...`);
            englishText = await translateText(text, langCode, 'en_XX');
        }

        // Summarize the English text
        console.log('Generating summary...');
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

        let summary;
        if (Array.isArray(summaryResult) && summaryResult[0] && summaryResult[0].summary_text) {
            summary = summaryResult[0].summary_text;
        } else if (summaryResult.summary_text) {
            summary = summaryResult.summary_text;
        } else {
            throw new Error('Invalid summary response format');
        }

        // Translate summary back if needed
        if (language !== 'English') {
            const langCode = getLanguageCode(language);
            console.log(`Translating summary back to ${language}...`);
            summary = await translateText(summary, 'en_XX', langCode);
        }

        // Post-process summary
        summary = summary.trim();
        if (summary.length > 0) {
            summary = summary.charAt(0).toUpperCase() + summary.slice(1);
            if (!summary.match(/[.!?]$/)) {
                summary += '.';
            }
        }

        res.json({ 
            summary: summary || 'Summary could not be generated.',
            originalLanguage: originalLanguage 
        });

    } catch (error) {
        console.error('Summarization error:', error);
        res.status(500).json({ 
            error: 'An error occurred while processing the text. Please try again.',
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
    return languageCodes[language] || null;
}

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.stack);
    res.status(500).json({
        error: 'Something went wrong on the server.',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// Health check endpoint (fixed status code)
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Handle 404 for API routes
app.use('/api/*', (req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    process.exit(0);
});

app.listen(port, () => {
    console.log(`🚀 Server running at http://localhost:${port}`);
    console.log(`📁 Serving static files from 'public' directory`);
    console.log(`🔑 API Token: ${API_TOKEN ? 'Configured' : 'Missing'}`);
});