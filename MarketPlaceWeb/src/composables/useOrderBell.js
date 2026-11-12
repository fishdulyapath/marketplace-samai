import { onBeforeUnmount, onMounted, ref } from 'vue';
import bellUrl from '@/assets/bellsound.mp3';

export function useOrderBell(storageKey, hasWaitingOrders) {
    const soundOn = ref(true);
    const needsGesture = ref(false);
    let audio;
    onMounted(() => {
        try { soundOn.value = localStorage.getItem(storageKey()) !== 'off'; } catch { /* Use session preference. */ }
        audio = new Audio(bellUrl);
    });
    function stopSound() { audio?.pause(); }
    onBeforeUnmount(() => { stopSound(); audio = null; });
    async function ring() {
        if (!audio || !soundOn.value || !hasWaitingOrders()) return;
        try {
            audio.currentTime = 0;
            await audio.play();
            needsGesture.value = false;
        } catch (err) {
            if (err.name === 'NotAllowedError') needsGesture.value = true;
        }
    }
    function toggleSound() {
        soundOn.value = needsGesture.value || !soundOn.value;
        needsGesture.value = false;
        try { localStorage.setItem(storageKey(), soundOn.value ? 'on' : 'off'); } catch { /* Use session preference. */ }
        if (soundOn.value) void ring();
        else stopSound();
    }
    return { soundOn, needsGesture, ring, toggleSound, stopSound };
}
