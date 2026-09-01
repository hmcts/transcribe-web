# Frontend Tests

This directory contains tests for the frontend application, organized by type.

## Directory Structure

```
tests/
├── unit/                    # Unit tests (isolated, mocked dependencies)
│   └── azure-upload.unit.test.ts
├── integration/             # Integration tests (with real services)
│   └── azure-upload.integration.test.ts
├── fixtures.ts              # Shared test utilities and mock data
├── setup.ts                 # Vitest configuration and global setup
└── README.md
```

## Running Tests

### All Tests
```bash
npm test
```

### Unit Tests Only
```bash
npm test -- tests/unit
```

### Integration Tests
Integration tests require environment setup and will upload to real Azure Storage:

```bash
# Set environment variables
export TEST_INTEGRATION=true
export NEXT_PUBLIC_API_URL=http://localhost:8000

# Run integration tests
npm test -- --run tests/integration
```

### Watch Mode
```bash
npm test -- --watch
```

### Specific Test File
```bash
npm test -- --run tests/unit/azure-upload.unit.test.ts
```

## Test Types

### Unit Tests (`tests/unit/`)
- Fast, isolated tests with mocked dependencies
- No network calls or external services
- Test individual functions and components
- Run by default with `npm test`

**Key features:**
- Mock `XMLHttpRequest` for upload simulation
- Mock API client responses
- Test error handling and edge cases
- Verify Azure Block Blob API usage

### Integration Tests (`tests/integration/`)
- Test with real Azure Storage (justicetransdevstor)
- Require backend API to be running
- Upload actual files and verify results
- Skipped by default (use `TEST_INTEGRATION=true`)

**Key features:**
- Upload small and large files
- Test chunked upload behavior
- Measure upload performance
- Verify cleanup operations

## Environment Variables

### Required for Integration Tests
- `TEST_INTEGRATION=true` - Enable integration tests
- `NEXT_PUBLIC_API_URL` - Backend API URL (default: http://localhost:8000)

### Backend Must Be Running
Integration tests require the backend server to be running:
```bash
# In backend directory
make backend
```

## Writing New Tests

### Unit Test Template
```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { yourFunction } from "@/lib/your-module";

describe("Your Module", () => {
  beforeEach(() => {
    // Setup
  });

  it("should do something", () => {
    // Test
    expect(yourFunction()).toBe(expected);
  });
});
```

### Integration Test Template
```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const runIntegrationTests = process.env.TEST_INTEGRATION === "true";
const describeIntegration = runIntegrationTests ? describe : describe.skip;

describeIntegration("Feature Integration Tests", () => {
  beforeAll(() => {
    // Setup
  });

  afterAll(async () => {
    // Cleanup
  });

  it("should integrate with real service", async () => {
    // Test
  }, 30000); // Extended timeout
});
```

## Test Fixtures

The `fixtures.ts` file provides utilities for creating test data:

### Mock Audio Blobs
```typescript
import { createMockAudioBlob } from "./fixtures";

const blob = createMockAudioBlob(1024 * 100, "audio/mp4"); // 100KB
```

### Mock Audio Chunks
```typescript
import { createMockAudioChunks } from "./fixtures";

const chunks = createMockAudioChunks(1024 * 200, 1024 * 50); // 200KB in 50KB chunks
```

### Mock Files
```typescript
import { createMockAudioFile } from "./fixtures";

const file = createMockAudioFile("test.mp4", 1024 * 100);
```

### Mock XMLHttpRequest
```typescript
import { MockXHRBuilder } from "./fixtures";

const mockXHR = new MockXHRBuilder();
mockXHR.status = 200;
// Use in tests...
```

## Continuous Integration

Tests are run automatically in CI/CD pipelines:
- Unit tests run on every commit
- Integration tests run on PR merge (requires Azure credentials)

## Troubleshooting

### Tests Hanging
- Check for missing `await` statements
- Ensure async operations have timeouts
- Use `--run` flag to disable watch mode

### Integration Tests Failing
- Verify backend is running: `curl http://localhost:8000/health`
- Check environment variables are set
- Ensure Azure credentials are valid
- Check network connectivity

### Mock Issues
- Clear mock state in `beforeEach` hooks
- Use `vi.clearAllMocks()` to reset mocks
- Verify mock implementations match real behavior

## Best Practices

1. **Isolate unit tests** - Mock all external dependencies
2. **Clean up integration tests** - Delete uploaded files in `afterAll`
3. **Use descriptive test names** - Clearly state what is being tested
4. **Test error cases** - Don't just test happy paths
5. **Keep tests fast** - Unit tests should run in milliseconds
6. **Use fixtures** - Reuse test data creation utilities
7. **Document complex tests** - Add comments for non-obvious logic

## Related Documentation

- [Backend Tests README](../../backend/tests/README.md)
- [Azure Upload Utility](../lib/azure-upload.ts)
- [Vitest Documentation](https://vitest.dev/)
