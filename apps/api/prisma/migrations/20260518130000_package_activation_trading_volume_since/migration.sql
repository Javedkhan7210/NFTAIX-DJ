-- Admin reset: only count trading volume on/after this timestamp for package + daily caps.
ALTER TABLE "PackageActivation" ADD COLUMN "tradingVolumeSince" TIMESTAMP(3);
