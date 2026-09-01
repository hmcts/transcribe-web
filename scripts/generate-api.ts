import { generate } from "openapi-typescript-codegen";

async function generateApi() {
  try {
    await generate({
      input: "http://localhost:8000/api/openapi.json",
      output: "./src/api/generated",
      exportCore: false,
      exportServices: false,
      exportModels: true,
    });
  } catch (error) {
    console.error(
      "❌ Failed to generate API types. Is your FastAPI server running?"
    );
    console.error(error);
    process.exit(1);
  }
}

generateApi();
