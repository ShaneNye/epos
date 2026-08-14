const DEFAULT_THRESHOLDS = Object.freeze({ minRequests: 4, highRequests: 10, trainingRatio: 0.6, systemRatio: 0.6, minLocations: 2, minUsers: 2 });

function confidence(score) { return score >= 80 ? "High" : score >= 55 ? "Medium" : "Low"; }
function clamp(n) { return Math.max(0, Math.min(100, Math.round(n))); }
function buildInsights(groups, options = {}) {
  const t = { ...DEFAULT_THRESHOLDS, ...options };
  return (groups || []).flatMap((g) => {
    const count = Number(g.requests || 0), userErrors = Number(g.user_errors || 0), systemErrors = Number(g.system_errors || 0);
    const users = Number(g.users || 0), locations = Number(g.locations || 0), seconds = Number(g.seconds || 0);
    if (count < t.minRequests) return [];
    const userRatio = userErrors / count, systemRatio = systemErrors / count;
    const common = { key: [g.system_name, g.category_name, g.issue_name].filter(Boolean).join(" → "), requests: count, userErrors, systemErrors, users, locations, seconds };
    const output = [];
    if (userRatio >= t.trainingRatio) {
      const score = clamp(30 + userRatio * 45 + Math.min(count, 15) * 2 + (seconds >= 3600 ? 8 : 0));
      output.push({ ...common, type: "training", title: `${g.issue_name} may benefit from refresher training`, score, confidence: confidence(score), recommendation: `Provide supportive refresher guidance for ${g.issue_name}.` });
    }
    if (systemRatio >= t.systemRatio && locations >= t.minLocations) {
      const score = clamp(35 + systemRatio * 45 + locations * 4 + (count >= t.highRequests ? 8 : 0));
      output.push({ ...common, type: "system", title: `Possible ${g.system_name} issue affecting multiple locations`, score, confidence: confidence(score), recommendation: "Review logs and escalate this repeat technical pattern." });
    }
    if (locations >= t.minLocations && users >= t.minUsers && systemRatio < 0.5 && userRatio < 0.6) {
      const score = clamp(25 + locations * 6 + users * 3 + Math.min(count, 15) * 2);
      output.push({ ...common, type: "process", title: `The ${g.issue_name} process may need reviewing`, score, confidence: confidence(score), recommendation: "Review whether the process is unclear or unnecessarily complex." });
    }
    if (count >= t.minRequests) {
      const score = clamp(25 + Math.min(count, 20) * 3 + Math.min(locations, 5) * 2);
      output.push({ ...common, type: "recurring", title: `Recurring support demand: ${g.issue_name}`, score, confidence: confidence(score), recommendation: "Review the underlying records and agree a preventative action." });
    }
    return output;
  }).sort((a, b) => b.score - a.score).slice(0, 12);
}
module.exports = { DEFAULT_THRESHOLDS, buildInsights };
