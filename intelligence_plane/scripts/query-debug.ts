import { DiscoveryQueryPlanner } from '../src/server/discovery/DiscoveryQueryPlanner';

const planner = new DiscoveryQueryPlanner();
const orgQueries = planner.generateOrganizationQueries({});
console.log("Organization Queries:");
orgQueries.forEach(q => console.log(`- ${q.query}`));

const signalQueries = planner.generateSignalQueries("ZetaFlow", "zetaflow.ai", {});
console.log("\nSignal Queries for ZetaFlow:");
signalQueries.forEach(q => console.log(`- ${q.query}`));
