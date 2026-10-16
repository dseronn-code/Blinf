-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "certPassword" TEXT,
ADD COLUMN     "certPfx" BYTEA,
ADD COLUMN     "certSerial" TEXT,
ADD COLUMN     "sefazMode" TEXT NOT NULL DEFAULT 'SIMULADO';

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "cbsValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "contingency" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "difalValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "fcpValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "finalidade" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "ibsValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "icmsStBase" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "icmsStValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "refAccessKey" TEXT,
ADD COLUMN     "returnId" TEXT,
ADD COLUMN     "signed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "transferId" TEXT;

-- AlterTable
ALTER TABLE "InvoiceItem" ADD COLUMN     "cbsRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "cbsValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "difalValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "fcpValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "ibsRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "ibsValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "icmsStBase" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "icmsStValue" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PosTransaction" ADD COLUMN     "anticipated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "settledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "images" TEXT[],
ADD COLUMN     "mvaST" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "scaleCode" TEXT;

-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN     "couponCode" TEXT,
ADD COLUMN     "parentOrderId" TEXT;

-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN     "volumes" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "customDomain" TEXT,
ADD COLUMN     "freeShippingUfs" TEXT[],
ADD COLUMN     "seoDescription" TEXT,
ADD COLUMN     "seoTitle" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "resetExpires" TIMESTAMP(3),
ADD COLUMN     "resetToken" TEXT,
ADD COLUMN     "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "twoFactorSecret" TEXT;

-- CreateTable
CREATE TABLE "Upload" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NumberVoid" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "series" INTEGER NOT NULL,
    "fromNumber" INTEGER NOT NULL,
    "toNumber" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NumberVoid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesReturn" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ABERTA',
    "kind" TEXT NOT NULL DEFAULT 'DEVOLUCAO',
    "reason" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "refundMethod" TEXT NOT NULL DEFAULT 'ESTORNO',
    "invoiceId" TEXT,
    "refundEntryId" TEXT,
    "exchangeOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SalesReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyTransfer" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "fromCompanyId" TEXT NOT NULL,
    "toCompanyId" TEXT NOT NULL,
    "fromWarehouseId" TEXT NOT NULL,
    "toWarehouseId" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "invoiceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CONCLUIDA',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NfeDistribution" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "accessKey" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "issuerName" TEXT NOT NULL,
    "issuerCnpj" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SEM_MANIFESTACAO',
    "xml" TEXT NOT NULL,
    "inboundId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NfeDistribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Coupon" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'PERCENTUAL',
    "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxUses" INTEGER NOT NULL DEFAULT 0,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "validUntil" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryCount" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ABERTO',
    "notes" TEXT,
    "userName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "InventoryCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryCountItem" (
    "id" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "expected" DOUBLE PRECISION NOT NULL,
    "counted" DOUBLE PRECISION,

    CONSTRAINT "InventoryCountItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostAllocation" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "costCenterId" TEXT NOT NULL,
    "percent" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "CostAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "chartAccountId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxMessage" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'EMAIL',
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "error" TEXT,
    "related" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "OutboxMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doneAt" TIMESTAMP(3),

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalesReturn_companyId_number_key" ON "SalesReturn"("companyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "NfeDistribution_companyId_accessKey_key" ON "NfeDistribution"("companyId", "accessKey");

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_companyId_code_key" ON "Coupon"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryCount_companyId_number_key" ON "InventoryCount"("companyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryCountItem_countId_productId_key" ON "InventoryCountItem"("countId", "productId");

-- CreateIndex
CREATE INDEX "CostAllocation_entryId_idx" ON "CostAllocation"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "Budget_companyId_chartAccountId_year_month_key" ON "Budget"("companyId", "chartAccountId", "year", "month");

-- CreateIndex
CREATE INDEX "OutboxMessage_companyId_createdAt_idx" ON "OutboxMessage"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "Job_status_runAt_idx" ON "Job"("status", "runAt");

-- CreateIndex
CREATE UNIQUE INDEX "Store_customDomain_key" ON "Store"("customDomain");

-- CreateIndex
CREATE UNIQUE INDEX "User_resetToken_key" ON "User"("resetToken");

-- AddForeignKey
ALTER TABLE "InventoryCountItem" ADD CONSTRAINT "InventoryCountItem_countId_fkey" FOREIGN KEY ("countId") REFERENCES "InventoryCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

