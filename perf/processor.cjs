// Artillery processor for production performance gate
// Sets up request context with API key from environment

module.exports = {
  /**
   * beforeRequest hook - called before each HTTP request
   * Injects ASSIST_API_KEY from environment into request context
   */
  beforeRequest: (requestParams, context, ee, next) => {
    // Set apiKey variable from environment if not already set
    if (!context.vars.apiKey && process.env.ASSIST_API_KEY) {
      context.vars.apiKey = process.env.ASSIST_API_KEY;
    }
    return next();
  }
};
