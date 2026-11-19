/**
 * Which lock channels are unlocked right now. After an accepted pulse the channel counts as open
 * for the controller's pulse length, the same time the ESP32 holds the output.
 */
export class OpenDoors {
  private timers = new Map<number, ReturnType<typeof setTimeout>>();

  constructor(private readonly onChange: () => void) {}

  open(channel: number, ms: number): void {
    const running = this.timers.get(channel);
    if (running !== undefined) clearTimeout(running);
    this.timers.set(
      channel,
      setTimeout(() => {
        this.timers.delete(channel);
        this.onChange();
      }, ms),
    );
    this.onChange();
  }

  channels(): number[] {
    return [...this.timers.keys()].sort((a, b) => a - b);
  }

  clear(): void {
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();
  }
}
