/*
 Text-to-speech functions
 */
import {useCallback, useEffect, useRef} from "react";
import {AppSettings} from "./settings-db.ts";
import {speech} from "./speech.ts";
import {useDBSetting} from "./settings-db.ts";


export function SpeechSynthesisPanel() {
    const [selectedVoiceName, setSelectedVoiceName] = useDBSetting<string>(AppSettings.SPEECH_VOICE, findDefaultVoice()?.name || "default");
    const [speechEnabled, setSpeechEnabled] = useDBSetting<boolean>(AppSettings.SPEECH_ENABLED, false);
    const enableSpeechCheckboxRef = useRef<HTMLInputElement>(null);

    const updateSelectedVoice = useCallback((voiceName: string) => {
        const foundVoice = findVoiceByName(voiceName);
        console.log(`looking for voice '${voiceName}'; found voice ${foundVoice?.name}`)
        if(foundVoice) {
            speech.setSelectedVoice(foundVoice);
            setSelectedVoiceName(voiceName)
            speech.sayItLater(`This is ${foundVoice.name} speaking.`)
        }
    }, [setSelectedVoiceName])

    useEffect(() => {
        updateSelectedVoice(selectedVoiceName)
    }, [selectedVoiceName, updateSelectedVoice])

    useEffect(() => {
        speech.setSpeechEnabled(speechEnabled);
        if (speechEnabled) {
            speech.sayIt(`This is ${selectedVoiceName}; speech is enabled.`)
        } else {
            speechSynthesis.cancel();
        }
    }, [speechEnabled, selectedVoiceName]);


    function findDefaultVoice() {
        if (!speechSynthesis) {
            console.log("speechSynthesis not ready")
            return null;
        }
        const allVoices = speechSynthesis.getVoices();
        const foundVoice = allVoices.find((voice) => voice.default);
        return foundVoice ? foundVoice : null;
    }

    function findVoiceByName(name: string) {
        return speech.getAllVoices().find((voice) => voice.name === name) || null;
    }


    return (
        <>
            <div style={{display: "inline-block"}}>
                <input type="checkbox" ref={enableSpeechCheckboxRef} id="enable-speech-checkbox" checked={speechEnabled}
                       onChange={e => setSpeechEnabled(e.target.checked)}/>
                <label htmlFor="enable-speech-checkbox">Enable Speech</label>
            </div>
            &nbsp;
            <select value={selectedVoiceName} onChange={e => setSelectedVoiceName(e.target.value)}>
                {
                    speech.getAllVoices().map((voice) => {
                        return <option key={voice.name}
                                       value={voice.name}>{`${voice.name} (${voice.lang}) ${voice.default ? " DEFAULT" : ""}`}</option>
                    })
                }
            </select>
        </>
    );
}
