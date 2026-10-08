// Deliberate large-download extension of the opt-in real Piper acceptance.
// Only these two additional weight files are requested, not the entire catalog.
export const selectedHighVoiceIds = [
  "en_US-libritts-high",
  "de_DE-thorsten-high",
];
export const acceptanceVoiceIds = [
  "en_GB-alan-medium",
  "sv_SE-nst-medium",
  ...selectedHighVoiceIds,
];
export const acceptanceModelFiles = acceptanceVoiceIds.flatMap((voice) => [
  `${voice}.onnx`,
  `${voice}.onnx.json`,
]);

export async function selectedHighVoicePreviews({ page, api, results }) {
  const catalog = await api("/presentation/voices");
  for (const id of selectedHighVoiceIds) {
    const voice = catalog.voices.find((voice) => voice.id === id);
    if (
      !voice ||
      voice.quality !== "high" ||
      voice.speakerId !== 0 ||
      voice.sampleRate !== 22050
    )
      throw new Error(
        `Expected selected high-quality catalog metadata for ${id}`,
      );
    await page
      .getByRole("button", {
        name: "Local only: storage and privacy",
        exact: true,
      })
      .click();
    await page.getByLabel("Narration voice").selectOption(id);
    await page.getByRole("button", { name: "Save voice", exact: true }).click();
    const started = Date.now();
    await page
      .getByRole("button", { name: "Preview voice", exact: true })
      .click();
    await page.waitForFunction(
      (id) => window.__speech.audio.some((wave) => wave.voice === id),
      id,
      { timeout: 240000 },
    );
    const wave = await page.evaluate(
      (id) => window.__speech.audio.find((wave) => wave.voice === id),
      id,
    );
    if (wave.rms < 0.001 || wave.rate !== 22050 || wave.duration <= 0.2)
      throw new Error(
        `Selected real ${id} preview returned silent/invalid WAV`,
      );
    await page
      .getByRole("button", { name: "Cancel voice preview", exact: true })
      .click();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    results.cases.push({
      name: `real selected high-quality neural preview: ${id}`,
      ms: Date.now() - started,
      speakerId: voice.speakerId,
      wave,
    });
  }
}
