import { afterEach, describe, expect, it, vi } from "vitest";
import { createHonchoClient } from "../src/honcho-client.js";
import { peerIdForAgent, peerIdForUser, systemPeerId } from "../src/ids.js";
import { createConclusionsForIssue, synthesizeIssue } from "../src/sync.js";
import plugin from "../src/worker.js";
import {
  BASE_CONFIG,
  buildDefaultFixtures,
  createHonchoHarness,
  installFetchMock,
  requestsMatching,
} from "./helpers.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("synthesis logic", () => {
  describe("synthesizeIssue", () => {
    it("synthesizes issue with explicit summary and conclusions and updates sync state", async () => {
      // Arrange
      const { requests } = installFetchMock();
      const mockHarness = createHonchoHarness();
      await plugin.definition.setup(mockHarness.ctx);
      const inputSummary = "Fixed authentication token refreshing in Redis session store";
      const inputConclusions = [
        "Session cookie expiration now matches JWT exp claim",
        "Redis store configured with failover replica support",
      ];
      // Act
      const actualResult = await synthesizeIssue(mockHarness.ctx, "iss_1", "co_1", {
        summary: inputSummary,
        conclusions: inputConclusions,
        agentId: "agent_1",
      });
      // Assert
      expect(actualResult.issueId).toBe("iss_1");
      expect(actualResult.issueIdentifier).toBe("PAP-1");
      expect(actualResult.summary).toBe(inputSummary);
      expect(actualResult.conclusions).toHaveLength(2);
      expect(actualResult.conclusions[0]?.content).toBe(inputConclusions[0]);
      expect(actualResult.conclusions[1]?.content).toBe(inputConclusions[1]);
      const mockConclusionRequests = requestsMatching(requests, "/conclusions");
      expect(mockConclusionRequests).toHaveLength(1);
      const mockRequestBody = mockConclusionRequests[0]?.body as {
        conclusions: Array<{ content: string; observer_id: string; observed_id: string; session_id: string }>;
      };
      expect(mockRequestBody.conclusions).toHaveLength(2);
      expect(mockRequestBody.conclusions[0]?.observer_id).toBe(peerIdForAgent("agent_1", "Agent One"));
      expect(mockRequestBody.conclusions[0]?.observed_id).toBe(peerIdForUser("user_1"));
      expect(mockRequestBody.conclusions[0]?.session_id).toBe("PAP-1");
      const actualState = mockHarness.getState({
        scopeKind: "issue",
        scopeId: "iss_1",
        namespace: "honcho",
        stateKey: "issue-sync-status",
      }) as Record<string, unknown>;
      expect(actualState.latestSynthesizedAt).toBe(actualResult.synthesizedAt);
      expect(actualState.latestSynthesisSummary).toBe(inputSummary);
      expect(actualState.latestSynthesisConclusionsCount).toBe(2);
    });

    it("falls back to derived conclusion when summary is provided without explicit conclusions", async () => {
      // Arrange
      const { requests } = installFetchMock();
      const mockHarness = createHonchoHarness();
      await plugin.definition.setup(mockHarness.ctx);
      const inputSummary = "Resolved deadlock in concurrent worker runs";
      // Act
      const actualResult = await synthesizeIssue(mockHarness.ctx, "iss_1", "co_1", {
        summary: inputSummary,
      });
      // Assert
      const expectedConclusionText = "Issue PAP-1 (Fix auth regression) [status=todo]: Resolved deadlock in concurrent worker runs";
      expect(actualResult.conclusions).toHaveLength(1);
      expect(actualResult.conclusions[0]?.content).toBe(expectedConclusionText);
      const mockConclusionRequests = requestsMatching(requests, "/conclusions");
      const mockRequestBody = mockConclusionRequests[0]?.body as {
        conclusions: Array<{ content: string }>;
      };
      expect(mockRequestBody.conclusions[0]?.content).toBe(expectedConclusionText);
    });

    it("falls back to session context preview when neither summary nor conclusions are provided", async () => {
      // Arrange
      const mockSessionPreview = "Investigating auth regression and root cause analysis.";
      const { requests } = installFetchMock({
        summaries: [mockSessionPreview],
      });
      const mockHarness = createHonchoHarness();
      await plugin.definition.setup(mockHarness.ctx);
      // Act
      const actualResult = await synthesizeIssue(mockHarness.ctx, "iss_1", "co_1", {});
      // Assert
      const expectedConclusionText = `Issue PAP-1 (Fix auth regression) [status=todo]: ${mockSessionPreview}`;
      expect(actualResult.summary).toBe(mockSessionPreview);
      expect(actualResult.conclusions[0]?.content).toBe(expectedConclusionText);
      const mockConclusionRequests = requestsMatching(requests, "/conclusions");
      const mockRequestBody = mockConclusionRequests[0]?.body as {
        conclusions: Array<{ content: string }>;
      };
      expect(mockRequestBody.conclusions[0]?.content).toBe(expectedConclusionText);
    });

    it("falls back to default completion statement when no summary, conclusions, or session context exist", async () => {
      // Arrange
      const { requests } = installFetchMock({
        summaries: [""],
      });
      const mockHarness = createHonchoHarness();
      await plugin.definition.setup(mockHarness.ctx);
      // Act
      const actualResult = await synthesizeIssue(mockHarness.ctx, "iss_1", "co_1", {});
      // Assert
      const expectedConclusionText = "Issue PAP-1 (Fix auth regression) completed with status todo.";
      expect(actualResult.summary).toBeNull();
      expect(actualResult.conclusions[0]?.content).toBe(expectedConclusionText);
      const mockConclusionRequests = requestsMatching(requests, "/conclusions");
      const mockRequestBody = mockConclusionRequests[0]?.body as {
        conclusions: Array<{ content: string }>;
      };
      expect(mockRequestBody.conclusions[0]?.content).toBe(expectedConclusionText);
    });

    it("resolves observer to system peer when issue is unassigned and no agentId is passed", async () => {
      // Arrange
      const { requests } = installFetchMock();
      const mockFixtures = buildDefaultFixtures();
      const mockHarness = createHonchoHarness({
        seed: {
          issues: [
            {
              ...mockFixtures.issues[0],
              assigneeAgentId: null,
              createdByUserId: null,
            },
          ],
        },
      });
      await plugin.definition.setup(mockHarness.ctx);
      // Act
      const actualResult = await synthesizeIssue(mockHarness.ctx, "iss_1", "co_1", {
        conclusions: ["Synthesis completed without assignee"],
      });
      // Assert
      expect(actualResult.conclusions).toHaveLength(1);
      const mockConclusionRequests = requestsMatching(requests, "/conclusions");
      const mockRequestBody = mockConclusionRequests[0]?.body as {
        conclusions: Array<{ observer_id: string; observed_id: string }>;
      };
      expect(mockRequestBody.conclusions[0]?.observer_id).toBe(systemPeerId());
      expect(mockRequestBody.conclusions[0]?.observed_id).toBe(systemPeerId());
    });

    it("resolves observed peer to assignee agent when issue has no createdByUserId and different assignee", async () => {
      // Arrange
      const { requests } = installFetchMock();
      const mockFixtures = buildDefaultFixtures();
      const mockHarness = createHonchoHarness({
        seed: {
          issues: [
            {
              ...mockFixtures.issues[0],
              assigneeAgentId: "agent_assigned",
              createdByUserId: null,
            },
          ],
          agents: [
            ...mockFixtures.agents,
            {
              ...mockFixtures.agents[0],
              id: "agent_assigned",
              name: "Assigned Worker",
            },
          ],
        },
      });
      await plugin.definition.setup(mockHarness.ctx);
      // Act
      await synthesizeIssue(mockHarness.ctx, "iss_1", "co_1", {
        agentId: "agent_observer",
        conclusions: ["Synthesized peer handoff observation"],
      });
      // Assert
      const mockConclusionRequests = requestsMatching(requests, "/conclusions");
      const mockRequestBody = mockConclusionRequests[0]?.body as {
        conclusions: Array<{ observer_id: string; observed_id: string }>;
      };
      expect(mockRequestBody.conclusions[0]?.observer_id).toBe(peerIdForAgent("agent_observer", null));
      expect(mockRequestBody.conclusions[0]?.observed_id).toBe(peerIdForAgent("agent_assigned", "Assigned Worker"));
    });

    it("throws an error when the issue does not exist", async () => {
      // Arrange
      installFetchMock();
      const mockHarness = createHonchoHarness();
      await plugin.definition.setup(mockHarness.ctx);
      // Act & Assert
      await expect(
        synthesizeIssue(mockHarness.ctx, "non_existent_issue", "co_1"),
      ).rejects.toThrow("Issue not found: non_existent_issue");
    });

    it("continues synthesis even if pre-synthesis sync fails", async () => {
      // Arrange
      const { requests } = installFetchMock({
        failOnceOn: ["/messages"],
      });
      const mockHarness = createHonchoHarness();
      await plugin.definition.setup(mockHarness.ctx);
      // Act
      const actualResult = await synthesizeIssue(mockHarness.ctx, "iss_1", "co_1", {
        summary: "Synthesis proceeded after failed message sync",
      });
      // Assert
      expect(actualResult.summary).toBe("Synthesis proceeded after failed message sync");
      expect(requestsMatching(requests, "/conclusions")).toHaveLength(1);
      expect(mockHarness.logs).toContainEqual(
        expect.objectContaining({
          level: "warn",
          message: "Sync before synthesis encountered error",
        }),
      );
    });

    it("continues synthesis gracefully if session context fetching fails", async () => {
      // Arrange
      const { requests } = installFetchMock({
        failOn: ["/context"],
      });
      const mockHarness = createHonchoHarness();
      await plugin.definition.setup(mockHarness.ctx);
      // Act
      const actualResult = await synthesizeIssue(mockHarness.ctx, "iss_1", "co_1", {});
      // Assert
      expect(actualResult.summary).toBeNull();
      expect(actualResult.conclusions[0]?.content).toBe("Issue PAP-1 (Fix auth regression) completed with status todo.");
      expect(requestsMatching(requests, "/conclusions")).toHaveLength(1);
    });
  });

  describe("createConclusionsForIssue", () => {
    it("creates multiple conclusions with default and explicit peer mappings", async () => {
      // Arrange
      const { requests } = installFetchMock();
      const mockHarness = createHonchoHarness();
      await plugin.definition.setup(mockHarness.ctx);
      const inputConclusions = [
        { content: "Default mapped conclusion" },
        { content: "Explicit mapped conclusion", observerId: "custom_observer", observedId: "custom_observed" },
      ];
      // Act
      const actualResult = await createConclusionsForIssue(
        mockHarness.ctx,
        "co_1",
        "iss_1",
        inputConclusions,
        "agent_1",
      );
      // Assert
      expect(actualResult).toHaveLength(2);
      const mockConclusionRequests = requestsMatching(requests, "/conclusions");
      expect(mockConclusionRequests).toHaveLength(1);
      const mockRequestBody = mockConclusionRequests[0]?.body as {
        conclusions: Array<{ content: string; observer_id: string; observed_id: string; session_id: string }>;
      };
      expect(mockRequestBody.conclusions[0]?.content).toBe("Default mapped conclusion");
      expect(mockRequestBody.conclusions[0]?.observer_id).toBe(peerIdForAgent("agent_1", null));
      expect(mockRequestBody.conclusions[0]?.observed_id).toBe(peerIdForUser("user_1"));
      expect(mockRequestBody.conclusions[0]?.session_id).toBe("PAP-1");
      expect(mockRequestBody.conclusions[1]?.content).toBe("Explicit mapped conclusion");
      expect(mockRequestBody.conclusions[1]?.observer_id).toBe("custom_observer");
      expect(mockRequestBody.conclusions[1]?.observed_id).toBe("custom_observed");
      expect(mockRequestBody.conclusions[1]?.session_id).toBe("PAP-1");
    });

    it("throws an error when creating conclusions for a non-existent issue", async () => {
      // Arrange
      installFetchMock();
      const mockHarness = createHonchoHarness();
      await plugin.definition.setup(mockHarness.ctx);
      // Act & Assert
      await expect(
        createConclusionsForIssue(mockHarness.ctx, "co_1", "missing_issue_id", [{ content: "Test" }]),
      ).rejects.toThrow("Issue not found: missing_issue_id");
    });
  });

  describe("HonchoClient conclusion methods", () => {
    it("returns empty array without network request when creating empty conclusions", async () => {
      // Arrange
      const { requests } = installFetchMock();
      const mockHarness = createHonchoHarness();
      const mockClient = await createHonchoClient({ ctx: mockHarness.ctx, config: BASE_CONFIG });
      // Act
      const actualResult = await mockClient.createConclusions("co_1", []);
      // Assert
      expect(actualResult).toEqual([]);
      expect(requestsMatching(requests, "/conclusions")).toHaveLength(0);
    });

    it("supports items response payload format in createConclusions", async () => {
      // Arrange
      const mockHarness = createHonchoHarness();
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
        items: [
          {
            id: "concl_item_1",
            content: "Item formatted conclusion",
            observer_id: "obs_1",
            observed_id: "obs_2",
            session_id: "sess_1",
          },
        ],
      }), { status: 200 })));
      const mockClient = await createHonchoClient({ ctx: mockHarness.ctx, config: BASE_CONFIG });
      // Act
      const actualResult = await mockClient.createConclusions("co_1", [
        { content: "Item formatted conclusion", observerId: "obs_1", observedId: "obs_2", sessionId: "sess_1" },
      ]);
      // Assert
      expect(actualResult).toHaveLength(1);
      expect(actualResult[0]?.content).toBe("Item formatted conclusion");
    });

    it("supports fallback array formatting when createConclusions response lacks conclusions or items array", async () => {
      // Arrange
      const mockHarness = createHonchoHarness();
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
        ok: true,
      }), { status: 200 })));
      const mockClient = await createHonchoClient({ ctx: mockHarness.ctx, config: BASE_CONFIG });
      // Act
      const actualResult = await mockClient.createConclusions("co_1", [
        { content: "Fallback conclusion", observerId: "obs_1", observedId: "obs_2", sessionId: "sess_1" },
      ]);
      // Assert
      expect(actualResult).toEqual([
        {
          content: "Fallback conclusion",
          observer_id: "obs_1",
          observed_id: "obs_2",
          session_id: "sess_1",
        },
      ]);
    });

    it("lists conclusions with query parameters and handles conclusions array response", async () => {
      // Arrange
      const { requests } = installFetchMock({
        conclusions: [
          {
            id: "concl_listed_1",
            content: "Listed conclusion hit",
            observer_id: "obs_1",
            observed_id: "obs_2",
            session_id: "sess_filter",
            created_at: new Date().toISOString(),
          },
        ],
      });
      const mockHarness = createHonchoHarness();
      const mockClient = await createHonchoClient({ ctx: mockHarness.ctx, config: BASE_CONFIG });
      // Act
      const actualResult = await mockClient.listConclusions("co_1", {
        sessionId: "sess_filter",
        observedId: "obs_2",
        observerId: "obs_1",
        limit: 10,
      });
      // Assert
      expect(actualResult).toHaveLength(1);
      expect(actualResult[0]?.content).toBe("Listed conclusion hit");
      const mockListRequests = requestsMatching(requests, "/conclusions?");
      expect(mockListRequests).toHaveLength(1);
      expect(mockListRequests[0]?.url).toContain("session_id=sess_filter");
      expect(mockListRequests[0]?.url).toContain("observed_id=obs_2");
      expect(mockListRequests[0]?.url).toContain("observer_id=obs_1");
      expect(mockListRequests[0]?.url).toContain("limit=10");
    });

    it("supports items array format in listConclusions and empty array fallback", async () => {
      // Arrange
      const mockHarness = createHonchoHarness();
      vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("session_id=format_items")) {
          return new Response(JSON.stringify({
            items: [
              {
                id: "concl_item_2",
                content: "Item format list",
                observer_id: "obs_1",
                observed_id: "obs_2",
              },
            ],
          }), { status: 200 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      }));
      const mockClient = await createHonchoClient({ ctx: mockHarness.ctx, config: BASE_CONFIG });
      // Act
      const actualItemsResult = await mockClient.listConclusions("co_1", { sessionId: "format_items" });
      const actualEmptyResult = await mockClient.listConclusions("co_1", {});
      // Assert
      expect(actualItemsResult).toHaveLength(1);
      expect(actualItemsResult[0]?.content).toBe("Item format list");
      expect(actualEmptyResult).toEqual([]);
    });
  });
});
