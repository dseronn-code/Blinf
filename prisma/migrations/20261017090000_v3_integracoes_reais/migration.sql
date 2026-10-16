-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "fiscalProvider" TEXT NOT NULL DEFAULT 'SIMULADO',
ADD COLUMN     "ieSt" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "FinancialEntry" ADD COLUMN     "paymentUrl" TEXT,
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "providerRef" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "environment" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "procXml" TEXT,
ADD COLUMN     "providerRef" TEXT,
ADD COLUMN     "receipt" TEXT;

-- AlterTable
ALTER TABLE "OutboxMessage" ADD COLUMN     "html" TEXT,
ADD COLUMN     "providerRef" TEXT;

-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN     "labelUrl" TEXT,
ADD COLUMN     "providerRef" TEXT;

-- CreateTable
CREATE TABLE "IntegrationAccount" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'SANDBOX',
    "status" TEXT NOT NULL DEFAULT 'DESCONECTADO',
    "secrets" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "tokenExpiresAt" TIMESTAMP(3),
    "externalAccountId" TEXT,
    "accountName" TEXT,
    "lastError" TEXT,
    "lastCheckAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthState" (
    "state" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "userId" TEXT,
    "verifier" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthState_pkey" PRIMARY KEY ("state")
);

-- CreateTable
CREATE TABLE "IntegrationCall" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "provider" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" INTEGER,
    "durationMs" INTEGER,
    "request" TEXT,
    "response" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboundEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "companyId" TEXT,
    "topic" TEXT,
    "externalId" TEXT,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEBIDO',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "InboundEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mdfe" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "series" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'RASCUNHO',
    "environment" INTEGER NOT NULL DEFAULT 2,
    "accessKey" TEXT,
    "protocol" TEXT,
    "xml" TEXT,
    "rejection" TEXT,
    "ufStart" TEXT NOT NULL,
    "ufEnd" TEXT NOT NULL,
    "route" TEXT[],
    "loadCity" TEXT NOT NULL,
    "loadCityCode" TEXT NOT NULL,
    "unloadCity" TEXT NOT NULL,
    "unloadCityCode" TEXT NOT NULL,
    "vehiclePlate" TEXT NOT NULL,
    "vehicleTara" INTEGER NOT NULL DEFAULT 0,
    "vehicleUf" TEXT NOT NULL,
    "rntrc" TEXT,
    "driverName" TEXT NOT NULL,
    "driverCpf" TEXT NOT NULL,
    "invoiceKeys" TEXT[],
    "totalValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "events" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Mdfe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Gnre" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "uf" TEXT NOT NULL,
    "revenueCode" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "barcode" TEXT,
    "line" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "xml" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "Gnre_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "customerId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "interval" TEXT NOT NULL DEFAULT 'MENSAL',
    "billingDay" INTEGER NOT NULL DEFAULT 10,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "nextBillingDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ATIVO',
    "paymentMethod" TEXT NOT NULL DEFAULT 'BOLETO',
    "invoiceModel" TEXT NOT NULL DEFAULT 'NFSE',
    "adjustPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sellerId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractBilling" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "entryId" TEXT,
    "invoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractBilling_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationAccount_companyId_provider_key" ON "IntegrationAccount"("companyId", "provider");

-- CreateIndex
CREATE INDEX "IntegrationCall_companyId_createdAt_idx" ON "IntegrationCall"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "InboundEvent_provider_createdAt_idx" ON "InboundEvent"("provider", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Mdfe_companyId_series_number_key" ON "Mdfe"("companyId", "series", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_companyId_number_key" ON "Contract"("companyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "ContractBilling_contractId_period_key" ON "ContractBilling"("contractId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "EmailTemplate_companyId_key_key" ON "EmailTemplate"("companyId", "key");

-- AddForeignKey
ALTER TABLE "ContractBilling" ADD CONSTRAINT "ContractBilling_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

