/**
 * Arbiter Agent Placeholder
 *
 * Future: watches DisputeRaised events, fetches evidence from Swarm, votes.
 * Activated when disputeWindow > 0 escrows appear.
 */

export class ArbiterAgent {
  /** Watch for disputes and handle them */
  async handleDispute(_escrowId: number): Promise<void> {
    // TODO: fetch evidence from Swarm via contentHash
    // TODO: evaluate dispute validity
    // TODO: call voteOnDispute on-chain
    throw new Error('ArbiterAgent not yet implemented')
  }

  /** Start watching for disputes */
  async start(): Promise<void> {
    // TODO: subscribe to DisputeRaised events
  }

  /** Stop watching */
  stop(): void {
    // cleanup
  }
}
