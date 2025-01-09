const languageSelect = document.getElementById('language-select');
const inputText = document.getElementById('input-text');
const summarizeBtn = document.getElementById('summarize-btn');
const summaryOutput = document.getElementById('summary-output');
const errorModal = document.getElementById('error-modal');
const errorMessage = document.getElementById('error-message');
const closeModal = document.getElementsByClassName('close')[0];
const wordCounter = document.getElementById('word-count');
const copyBtn = document.getElementById('copy-btn');
const progressBar = document.getElementById('progress-bar');

// Event Listeners
summarizeBtn.addEventListener('click', summarizeText);
closeModal.addEventListener('click', closeErrorModal);
inputText.addEventListener('input', updateWordCount);
copyBtn.addEventListener('click', copyToClipboard);

window.addEventListener('click', (event) => {
    if (event.target === errorModal) {
        closeErrorModal();
    }
});

// Functions
function updateWordCount() {
    const words = inputText.value.trim().split(/\s+/).filter(word => word.length > 0);
    wordCounter.textContent = words.length;
    
    // Update textarea border based on word count
    const minWords = 100;
    inputText.classList.toggle('valid', words.length >= minWords);
    inputText.classList.toggle('invalid', words.length > 0 && words.length < minWords);
}

function showProgress() {
    progressBar.style.display = 'block';
    progressBar.querySelector('.progress-bar').style.width = '0%';
    
    return setInterval(() => {
        const currentWidth = parseFloat(progressBar.querySelector('.progress-bar').style.width);
        if (currentWidth < 90) {
            progressBar.querySelector('.progress-bar').style.width = `${currentWidth + 1}%`;
        }
    }, 500);
}

function hideProgress() {
    progressBar.querySelector('.progress-bar').style.width = '100%';
    setTimeout(() => {
        progressBar.style.display = 'none';
        progressBar.querySelector('.progress-bar').style.width = '0%';
    }, 300);
}

async function summarizeText() {
    const text = inputText.value.trim();
    const selectedLanguage = languageSelect.value;
    const words = text.split(/\s+/).filter(word => word.length > 0);

    if (words.length < 100) {
        showError('Please enter at least 100 words.');
        return;
    }

    // UI updates for processing state
    summarizeBtn.disabled = true;
    summarizeBtn.classList.add('loading');
    summaryOutput.innerHTML = '';
    summaryOutput.classList.remove('animate__animated', 'animate__fadeIn');
    copyBtn.style.display = 'none';

    const progressInterval = showProgress();

    try {
        const response = await fetch('/summarize', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ text, language: selectedLanguage }),
        });

        if (!response.ok) {
            throw new Error(await response.text());
        }

        const data = await response.json();
        displaySummary(data.summary, data.originalLanguage);
    } catch (error) {
        showError('An error occurred while processing the text. Please try again.');
    } finally {
        clearInterval(progressInterval);
        hideProgress();
        summarizeBtn.disabled = false;
        summarizeBtn.classList.remove('loading');
    }
}

function displaySummary(summary, originalLanguage) {
    summaryOutput.innerHTML = `
        <div class="summary-header">
            <span class="language-badge">${originalLanguage}</span>
            <span class="summary-stats">~${summary.split(/\s+/).length} words</span>
        </div>
        <div class="summary-text">${summary}</div>
    `;
    
    summaryOutput.classList.add('animate__animated', 'animate__fadeIn');
    copyBtn.style.display = 'block';
}

async function copyToClipboard() {
    const summaryText = summaryOutput.querySelector('.summary-text').textContent;
    try {
        await navigator.clipboard.writeText(summaryText);
        copyBtn.textContent = 'Copied!';
        setTimeout(() => {
            copyBtn.textContent = 'Copy Summary';
        }, 2000);
    } catch (err) {
        showError('Failed to copy text to clipboard');
    }
}

function showError(message) {
    errorMessage.textContent = message;
    errorModal.style.display = 'block';
    errorModal.querySelector('.modal-content').classList.remove('animate__fadeOutUp');
    errorModal.querySelector('.modal-content').classList.add('animate__fadeInDown');
}

function closeErrorModal() {
    errorModal.querySelector('.modal-content').classList.remove('animate__fadeInDown');
    errorModal.querySelector('.modal-content').classList.add('animate__fadeOutUp');
    setTimeout(() => {
        errorModal.style.display = 'none';
    }, 500);
}