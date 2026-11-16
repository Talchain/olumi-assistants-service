import { OpenAIResponsesModel, Usage, type ModelRequest, type ModelResponse, type ResponseStreamEvent } from '@openai/agents';

type SdkUsage = Extract<ResponseStreamEvent, { type: 'response_done' }>['response']['usage'];

/**
 * Agents 0.18 accepts only numeric token-detail entries. Responses can also return nested cache-write metadata.
 * Project only the SDK's bookkeeping fields; keep token totals and numeric details exactly as reported. The ledgered
 * client records the ORIGINAL provider usage and response digest before this projection, including nested details.
 * Do not coerce, sum or flatten those details into invented token counts.
 */
function numericDetails(details: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(details).filter(([, value]) => typeof value === 'number'));
}

function compatibleUsage(usage: SdkUsage): SdkUsage {
  return {
    ...usage,
    ...(usage.inputTokensDetails === undefined ? {} : {
      inputTokensDetails: Array.isArray(usage.inputTokensDetails)
        ? usage.inputTokensDetails.map(numericDetails) : numericDetails(usage.inputTokensDetails),
    }),
    ...(usage.outputTokensDetails === undefined ? {} : {
      outputTokensDetails: Array.isArray(usage.outputTokensDetails)
        ? usage.outputTokensDetails.map(numericDetails) : numericDetails(usage.outputTokensDetails),
    }),
    ...(usage.requestUsageEntries === undefined ? {} : {
      requestUsageEntries: usage.requestUsageEntries.map((entry) => ({
        ...entry,
        ...(entry.inputTokensDetails === undefined ? {} : { inputTokensDetails: numericDetails(entry.inputTokensDetails) }),
        ...(entry.outputTokensDetails === undefined ? {} : { outputTokensDetails: numericDetails(entry.outputTokensDetails) }),
      })),
    }),
  };
}

/** Use the SDK's public model interface, before the Runner validates a response or executes its tool calls. */
export class UsageCompatibleResponsesModel extends OpenAIResponsesModel {
  override async *getStreamedResponse(request: ModelRequest): AsyncIterable<ResponseStreamEvent> {
    for await (const event of super.getStreamedResponse(request)) {
      yield event.type === 'response_done'
        ? { ...event, response: { ...event.response, usage: compatibleUsage(event.response.usage) } }
        : event;
    }
  }

  override async getResponse(request: ModelRequest): Promise<ModelResponse> {
    const response = await super.getResponse(request);
    return { ...response, usage: new Usage(compatibleUsage(response.usage)) };
  }
}
