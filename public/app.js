const inputText = document.getElementById('inputText');
const summarizeButton = document.getElementById('summarizeButton');
const summaryContainer = document.getElementById('summaryContainer');
const summary = document.getElementById('summary');

inputText.addEventListener('input', () => {
  if (inputText.value.trim().length >= 150) {
    summarizeButton.disabled = false;
  } else {
    summarizeButton.disabled = true;
  }
});

summarizeButton.addEventListener('click', async () => {
  const text = inputText.value.trim();

  try {
    const response = await fetch('/summarize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ text })
    });
    const { summary: summaryText } = await response.json();
    summary.textContent = summaryText;
    summaryContainer.style.display = 'block';
  } catch (error) {
    console.error('Error:', error);
    alert('Something went wrong');
  }
});