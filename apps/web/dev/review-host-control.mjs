/** Advance only after the controlled provider or tool has installed its release callback. */
export async function advanceFixture(control) {
  let current, delayedToolGateObservations = 0;
  for (let i = 0; i < 150; i++) {
    const status = await fetch(control + '/state');
    if (!status.ok) throw new Error('Fixture state failed: ' + status.status);
    current = await status.json();
    if (current.stage === 'executing' && !current.canAdvance) delayedToolGateObservations++;
    if (current.canAdvance) {
      const response = await fetch(control + '/advance', { method: 'POST' });
      if (!response.ok || !(await response.json()).advanced) throw new Error('Fixture advance was not accepted: ' + JSON.stringify(current));
      return delayedToolGateObservations;
    }
    await new Promise(done => setTimeout(done, 100));
  }
  throw new Error('Fixture did not expose the next controlled step: ' + JSON.stringify(current));
}
