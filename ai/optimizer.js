class Optimizer {
  getModeProfile(mode, config) {
    if (mode === 'TRENDING') {
      return {
        threshold: config.thresholds.trending,
        riskMultiplier: config.risk.trendingBoost,
        allowReentry: true,
        allowScaleIn: true,
        exitAcceleration: 1
      };
    }
    if (mode === 'VOLATILE') {
      return {
        threshold: config.thresholds.volatile,
        riskMultiplier: config.risk.volatileReduction,
        allowReentry: false,
        allowScaleIn: false,
        exitAcceleration: 1.4
      };
    }
    return {
      threshold: config.thresholds.sideways,
      riskMultiplier: config.risk.sidewaysReduction,
      allowReentry: false,
      allowScaleIn: false,
      exitAcceleration: 0.8
    };
  }
}

module.exports = { Optimizer };
