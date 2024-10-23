/*
 Text-to-speech functions
 */
let selectedVoice;
let speechRate = 1;
let speechSynthesis;

export function setupSpeechSynthesis() {
    const synth = window.speechSynthesis;
    const inputForm = document.querySelector("form");
    const inputTxt = document.getElementById("say-this");
    const voiceSelect = document.getElementById("voice-select");
    const speechSpeedElement = document.getElementById("speech-speed");
    const speechRateLabel = document.getElementById("speech-rate-label");
    let voices;

    function populateVoiceList() {
        voices = synth.getVoices();

        for (const voice of voices) {
            const option = document.createElement("option");
            option.textContent = `${voice.name} (${voice.lang})`;

            if (voice.default) {
                option.textContent += " — DEFAULT";
                option.selected = true;
            }

            option.setAttribute("data-lang", voice.lang);
            option.setAttribute("data-name", voice.name);
            voiceSelect.appendChild(option);
        }
        voiceSelect.onchange = event => selectedVoice = voices.find((voice) => voice.name === event.target.getAttribute("data-name"));

        speechSpeedElement.onchange = event => {
            speechRate = event.target.value;
            speechRateLabel.innerText = speechRate;
        }
        speechSpeedElement.value = speechRate; // init
        speechRateLabel.innerText = speechRate; // init
    }

    populateVoiceList();
    if (synth.onvoiceschanged !== undefined) {
        synth.onvoiceschanged = populateVoiceList;
    }


    inputForm.onsubmit = (event) => {
        event.preventDefault();

        sayIt(inputTxt.value);
        inputTxt.blur();
    };

    speechSynthesis = synth;
}

export function quickSetupSpeechSynthesis() {
    const synth = window.speechSynthesis;
    const defaultVoice = synth.getVoices().find((voice) => voice.default);

    if (synth.onvoiceschanged !== undefined) {
        // synth.onvoiceschanged = populateVoiceList;
    }

    speechSynthesis = synth;
    selectedVoice = defaultVoice;
    speechRate = 1;
}

export function isSayingSomething() {
    return speechSynthesis.speaking;
}

/**
 * enqueue
 * @param message
 */
export function sayItLater(message) {
    console.log(`say it later: ${message}`)
    const utterThis = new SpeechSynthesisUtterance(message);
    utterThis.voice = selectedVoice;
    utterThis.rate = speechRate;

    speechSynthesis.speak(utterThis); // this enqueues
}

export function sayIt(message) {
    console.log(`say it ${message}`)
    const utterThis = new SpeechSynthesisUtterance(message);
    utterThis.voice = selectedVoice;
    utterThis.rate = speechRate;

    if(speechSynthesis.speaking) {
        speechSynthesis.cancel(); // stop current utterance
        // chrome needs a delay here for some reason, otherwise speak doesn't do anything.
        // 60 ms seems to be around the minimum delay
        setTimeout(() => speechSynthesis.speak(utterThis), 60)
    } else {
        speechSynthesis.speak(utterThis);
    }
}
