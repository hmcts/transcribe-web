/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * Request model for submitting Langfuse traces.
 */
export type LangfuseTraceRequest = {
  trace_id: string;
  name: string;
  metadata?: Record<string, any> | null;
  input_data?: Record<string, any> | string | null;
  output_data?: Record<string, any> | string | null;
};
