export class IterationBudget {
    private consumed = 0;

    constructor(private readonly maxTotal: number) {}

    consume(): boolean {
        if (this.consumed >= this.maxTotal) return false;
        this.consumed += 1;
        return true;
    }

    get remaining(): number {
        return Math.max(0, this.maxTotal - this.consumed);
    }
}
