import { cronJobs, makeFunctionReference } from 'convex/server';
const crons = cronJobs();
crons.interval('Resume pending Swarms', { minutes: 1 }, makeFunctionReference<'action'>('worker:wake'), {});
export default crons;
