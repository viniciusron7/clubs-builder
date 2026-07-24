/* ============================================================================
 * weights.js - Stable, position-independent OVR model.
 * Outfield coefficients come from old_analise_overall/pesos_overall.json.
 * GK was fitted with a sum-to-one model over base Common/Rare goalkeepers.
 * ========================================================================== */
(function () {
  const positions = {
    ST: {
      n: 3161, inSampleExact: 0.9215, intercept: 0.257525,
      weights: { acceleration: 0.039659, sprint_speed: 0.048163, strength: 0.046055, reactions: 0.085676, aggression: 0.000102, att_positioning: 0.131828, ball_control: 0.103444, dribbling: 0.067424, finishing: 0.192512, heading_accuracy: 0.099412, short_passing: 0.048953, shot_power: 0.092756, long_shots: 0.027881, volleys: 0.020361 },
    },
    RW: {
      n: 461, inSampleExact: 0.9176, intercept: 0.258122,
      weights: { acceleration: 0.069725, sprint_speed: 0.054289, agility: 0.030581, balance: 0.001572, stamina: 0.00119, strength: 0.003444, reactions: 0.073976, att_positioning: 0.086174, vision: 0.063167, ball_control: 0.147438, crossing: 0.099962, dribbling: 0.147694, finishing: 0.111534, long_passing: 0.001743, short_passing: 0.083194, long_shots: 0.03028 },
    },
    LW: {
      n: 448, inSampleExact: 0.9062, intercept: 0.313985,
      weights: { acceleration: 0.067237, sprint_speed: 0.06102, agility: 0.023157, stamina: 0.005535, strength: 0.001592, reactions: 0.07396, att_positioning: 0.088651, vision: 0.063222, ball_control: 0.147679, crossing: 0.099495, dribbling: 0.148001, finishing: 0.107178, short_passing: 0.086171, long_shots: 0.031964, standing_tackle: 0.001433 },
    },
    CAM: {
      n: 1264, inSampleExact: 0.9422, intercept: 0.55898,
      weights: { acceleration: 0.040112, sprint_speed: 0.029939, agility: 0.024958, stamina: 0.000531, strength: 0.001293, reactions: 0.081199, aggression: 0.000358, att_positioning: 0.090448, vision: 0.139234, ball_control: 0.146755, dribbling: 0.13006, finishing: 0.070969, long_passing: 0.040387, short_passing: 0.158783, long_shots: 0.045432 },
    },
    RM: {
      n: 1239, inSampleExact: 0.9443, intercept: 1.715894,
      weights: { acceleration: 0.066763, sprint_speed: 0.057567, jumping: 0.0001, stamina: 0.048204, strength: 0.000787, reactions: 0.074749, att_positioning: 0.080084, vision: 0.067737, ball_control: 0.13719, crossing: 0.102529, dribbling: 0.142788, finishing: 0.062059, long_passing: 0.047928, short_passing: 0.109283, standing_tackle: 0.000296 },
    },
    LM: {
      n: 1310, inSampleExact: 0.9275, intercept: 1.504685,
      weights: { acceleration: 0.065138, sprint_speed: 0.06054, balance: 0.000423, stamina: 0.04551, strength: 0.00098, reactions: 0.074392, aggression: 0.000694, interceptions: 0.000001, att_positioning: 0.08731, vision: 0.063066, ball_control: 0.136595, crossing: 0.098059, dribbling: 0.148272, finishing: 0.060811, long_passing: 0.043657, short_passing: 0.113999, sliding_tackle: 0.001199 },
    },
    CM: {
      n: 2642, inSampleExact: 0.9451, intercept: 0.138813,
      weights: { acceleration: 0.001358, sprint_speed: 0.002931, stamina: 0.056535, reactions: 0.086908, interceptions: 0.049454, att_positioning: 0.059336, vision: 0.128126, ball_control: 0.146681, dribbling: 0.068244, finishing: 0.022549, long_passing: 0.133147, short_passing: 0.161829, long_shots: 0.037233, standing_tackle: 0.052111 },
    },
    CDM: {
      n: 1655, inSampleExact: 0.9281, intercept: 1.194495,
      weights: { acceleration: 0.000657, sprint_speed: 0.003147, stamina: 0.056187, strength: 0.037881, reactions: 0.082456, aggression: 0.045989, interceptions: 0.133282, vision: 0.035454, ball_control: 0.096534, long_passing: 0.099827, short_passing: 0.151814, defensive_awareness: 0.088851, standing_tackle: 0.128323, sliding_tackle: 0.044099 },
    },
    RB: {
      n: 1630, inSampleExact: 0.9325, intercept: 2.454808,
      weights: { acceleration: 0.047921, sprint_speed: 0.066497, balance: 0.000483, stamina: 0.076788, reactions: 0.088696, interceptions: 0.118321, ball_control: 0.074401, crossing: 0.092347, heading_accuracy: 0.039839, short_passing: 0.06852, defensive_awareness: 0.075397, standing_tackle: 0.109896, sliding_tackle: 0.142658 },
    },
    LB: {
      n: 1553, inSampleExact: 0.9472, intercept: 2.434945,
      weights: { acceleration: 0.050626, sprint_speed: 0.065831, stamina: 0.075517, reactions: 0.086881, interceptions: 0.116422, ball_control: 0.070797, crossing: 0.092831, finishing: 0.00053, fk_accuracy: 0.000582, heading_accuracy: 0.041577, short_passing: 0.06859, defensive_awareness: 0.077453, standing_tackle: 0.108841, sliding_tackle: 0.145873 },
    },
    CB: {
      n: 3815, inSampleExact: 0.9405, intercept: 0.506439,
      weights: { acceleration: 0.002109, sprint_speed: 0.019688, jumping: 0.024532, stamina: 0.001798, strength: 0.095424, reactions: 0.05257, aggression: 0.067532, interceptions: 0.125905, ball_control: 0.041781, heading_accuracy: 0.101772, short_passing: 0.050508, defensive_awareness: 0.142266, standing_tackle: 0.174108, sliding_tackle: 0.102 },
    },
    GK: {
      n: 2303, crossValidationExact: 0.97872, intercept: 1.5160283051787933,
      weights: { gk_diving: 0.20992623705311783, gk_handling: 0.20961768310736006, gk_kicking: 0.04932163131930486, gk_reflexes: 0.21054234494434815, gk_positioning: 0.20992623705302138, reactions: 0.1106658665228476 },
    },
  };

  window.OVERALL_MODEL = {
    version: 2,
    source: {
      outfield: 'old_analise_overall/pesos_overall.json',
      goalkeeper: 'data/eafc26_ut_players.csv (Common/Rare base GK)',
    },
    formula: 'floor(intercept + sum(weight[attr] * purchased_attr))',
    rounding: 'floor',
    limits: { min: 1, max: 99 },
    trainingRange: { outfieldOverall: [47, 91], goalkeeperOverall: [47, 89] },
    metrics: {
      crossValidation5Fold: {
        outfieldAll: { n: 19363, exact: 0.92527, within1: 0.999845, mae: 0.07499, bias: -0.0118 },
        outfield75Plus: { n: 2528, exact: 0.86867, within1: 0.99921, mae: 0.1321, bias: -0.0253 },
        goalkeeper: { n: 2303, exact: 0.97872, within1: 1, mae: 0.0213, bias: -0.0013 },
      },
      fixedModelEvaluation: {
        outfieldAll: { n: 19363, exact: 0.9343077, within1: 0.9999484, mae: 0.0658472, bias: -0.0092444 },
        outfield75Plus: { n: 2528, exact: 0.880538, within1: 1, mae: 0.119462, bias: -0.022943 },
        goalkeeper: { n: 2303, exact: 0.9804603, within1: 1, mae: 0.0195397, bias: -0.0004342 },
      },
    },
    positions,
  };

  // Compatibility for code that still consumes the former weights shape.
  window.OVERALL_WEIGHTS = Object.fromEntries(Object.entries(positions).map(([position, formula]) => [
    position,
    { n: formula.n, exato: formula.inSampleExact || formula.crossValidationExact, intercepto_b: formula.intercept, pesos: formula.weights },
  ]));
})();
