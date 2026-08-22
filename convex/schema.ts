import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  companies: defineTable({
    name: v.string(),
    subscription_plan: v.string(), // e.g., 'free', 'pro'
  }),
  
  users: defineTable({
    companyId: v.id('companies'),
    email: v.string(),
    passwordHash: v.string(),
    role: v.string(), // e.g., 'admin', 'member'
  }).index("by_email", ["email"]),
  
  domain_verifications: defineTable({
    domain: v.string(),
    email: v.string(),
    token: v.string(),
    verified: v.boolean(),
    verified_at: v.optional(v.number()),
    expires_at: v.number(),
  }).index("by_domain_and_email", ["domain", "email"]),
  
  scan_history: defineTable({
    companyId: v.id('companies'),
    targetUrl: v.string(),
    platform: v.string(),
    status: v.string(),
    totalVulnerabilities: v.number(),
    reportJson: v.optional(v.string()), // Serialized JSON or could be Convex types
  }).index("by_company", ["companyId"]),
});
