const languageSelect = document.getElementById('language-select');
const inputText = document.getElementById('input-text');
const summarizeBtn = document.getElementById('summarize-btn');
const summaryOutput = document.getElementById('summary-output');
const errorModal = document.getElementById('error-modal');
const errorMessage = document.getElementById('error-message');
const closeModal = document.getElementsByClassName('close')[0];

summarizeBtn.addEventListener('click', summarizeText);
closeModal.addEventListener('click', () => errorModal.style.display = 'none');

window.addEventListener('click', (event) => {
    if (event.target === errorModal) {
        errorModal.style.display = 'none';
    }
});

async function summarizeText() {
    const text = inputText.value.trim();
    const selectedLanguage = languageSelect.value;

    if (text.split(' ').length < 200) {
        showError('Please enter at least 200 words.');
        return;
    }

    summarizeBtn.disabled = true;
    summarizeBtn.textContent = 'Summarizing...';
    summaryOutput.textContent = 'Please wait, this may take a minute...';

    try {
        const response = await fetch('/summarize', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ text, language: selectedLanguage }),
        });

        if (!response.ok) {
            throw new Error('Failed to fetch summary');
        }

        const data = await response.json();
        summaryOutput.textContent = data.summary;
        summaryOutput.classList.add('fade-in');
    } catch (error) {
        showError('An error occurred while summarizing the text. Please try again.');
    } finally {
        summarizeBtn.disabled = false;
        summarizeBtn.textContent = 'Summarize';
    }
}

function showError(message) {
    errorMessage.textContent = message;
    errorModal.style.display = 'block';
}