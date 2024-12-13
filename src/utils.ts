
export function convertFitFactorToFiltrationEfficiency(fitFactor:number) {
    const efficiency = 100 * (1.0 - 1.0 / fitFactor);
    const efficiencyPercentage: string = Number(efficiency).toFixed(efficiency < 99 ? 0 : 3)
    return efficiencyPercentage;
}


export function getFitFactorCssClass(fitFactor:number):string {
    if (fitFactor < 1.1) {
        // probably aborted
        return "result aborted"
    } else if (fitFactor < 20) {
        return "result low-fit-score"
    } else if (fitFactor < 100) {
        return "result moderate-fit-score"
    } else if (fitFactor >= 100) {
        return "result high-fit-score"
    } else {
        // NaN
        return "result aborted"
    }
}
