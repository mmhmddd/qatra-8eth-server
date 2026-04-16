// drop-ttl-index.js
// Run this ONCE after deploying the new User.js model.
// It removes the TTL index that was silently deleting user documents.
//
// Usage:
//   node drop-ttl-index.js

import mongoose from 'mongoose';
import { config } from 'dotenv';
config();

async function dropTTLIndex() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const collection = mongoose.connection.collection('users');

    // الطريقة الصحيحة لجلب الـ indexes
    const rawIndexes = await collection.listIndexes().toArray();

    console.log('\n📋 All current indexes on "users" collection:');
    rawIndexes.forEach(idx => {
      const ttlInfo = idx.expireAfterSeconds !== undefined
        ? `⚠️  TTL: ${idx.expireAfterSeconds}s`
        : '✅ Normal';
      console.log(` - ${idx.name} | ${ttlInfo}`);
    });

    const ttlIndexes = rawIndexes.filter(
      idx => idx.expireAfterSeconds !== undefined
    );

    if (ttlIndexes.length === 0) {
      console.log('\n✅ No TTL indexes found — nothing to drop.');
    } else {
      for (const idx of ttlIndexes) {
        console.log(`\n🗑️  Dropping TTL index: "${idx.name}"`);
        await collection.dropIndex(idx.name);
        console.log(`✅ Dropped: "${idx.name}"`);
      }
      console.log('\n✅ Done. Users will no longer be auto-deleted by MongoDB TTL.');
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
    process.exit(0);
  }
}

dropTTLIndex();