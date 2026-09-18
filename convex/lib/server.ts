import { queryGeneric, mutationGeneric, internalMutationGeneric, internalQueryGeneric, internalActionGeneric, type DataModelFromSchemaDefinition, type QueryBuilder, type MutationBuilder, type ActionBuilder } from 'convex/server';
import schema from '../schema';
type DataModel = DataModelFromSchemaDefinition<typeof schema>;
export const query = queryGeneric as QueryBuilder<DataModel, 'public'>;
export const mutation = mutationGeneric as MutationBuilder<DataModel, 'public'>;
export const internalMutation = internalMutationGeneric as MutationBuilder<DataModel, 'internal'>;
export const internalQuery = internalQueryGeneric as QueryBuilder<DataModel, 'internal'>;
export const internalAction = internalActionGeneric as ActionBuilder<DataModel, 'internal'>;
