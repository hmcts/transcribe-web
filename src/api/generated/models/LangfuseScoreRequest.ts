/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * Request model for submitting Langfuse scores.
 */
export type LangfuseScoreRequest = {
  trace_id: string;
  name: string;
  value: number;
  comment?: string | null;
};
