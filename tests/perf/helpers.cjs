// Artillery processor helpers for performance testing

const briefs = [
  // Simple (100-200 chars)
  "Should we hire full-time or contractors? Team is 10 people, budget is $500k annually.",

  // Medium (300-500 chars)
  "Should we expand to international markets or focus on domestic growth? Current revenue is $10M annually, team is 50 people, and we have $2M budget for expansion. Consider regulatory compliance, market research costs, and competitive landscape.",

  // Medium complexity
  "Make or buy decision for payment processing system with PCI compliance requirements. Current volume is 10k transactions per month. Consider implementation time, ongoing maintenance, and security risks.",

  // Hiring decision
  "Hire 3 full-time engineers or use contract workers? Team needs to scale quickly but budget is tight. Consider ramp-up time, team stability, and long-term costs.",

  // Architecture decision
  "Should we migrate to microservices or keep the monolith? Current system serves 100k users with 5-person team. Consider development velocity, operational complexity, and 10x growth requirements."
];

module.exports = {
  selectBrief: function(requestParams, context, ee, next) {
    // Select random brief from the pool
    const randomIndex = Math.floor(Math.random() * briefs.length);
    context.vars.brief = briefs[randomIndex];
    return next();
  }
};
