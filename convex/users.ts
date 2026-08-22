import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

export const getUserByEmail = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db.query("users")
      .withIndex("by_email", q => q.eq("email", args.email))
      .first();
  }
});

export const createCompany = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db.insert("companies", {
      name: args.name,
      subscription_plan: "free"
    });
  }
});

export const getCompany = query({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.companyId);
  }
});

export const createUser = mutation({
  args: {
    companyId: v.id("companies"),
    email: v.string(),
    passwordHash: v.string(),
    role: v.string()
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("users", {
      companyId: args.companyId,
      email: args.email,
      passwordHash: args.passwordHash,
      role: args.role
    });
  }
});
