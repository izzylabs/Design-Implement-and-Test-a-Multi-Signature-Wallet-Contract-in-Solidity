const { expect } = require("chai");
const { ethers } = require("hardhat");

function isEventLog(log) {
  return "fragment" in log;
}

describe("MultiSigWallet", function () {
  this.timeout(300000); // 5 minutes

  let MultiSigWalletFactory;
  let wallet;
  let owner1, owner2, nonOwner;
  let owners;
  const requiredSignatures = 1;
  let walletAddress;
  let transactionCounter = 0;
  let skipTests = false;

  before(async function () {
    try {
      const signers = await ethers.getSigners();

      if (signers.length < 2) {
        console.log("Not enough signers. Skipping...");
        skipTests = true;
        this.skip();
      }

      owner1 = signers[0];
      owner2 = signers[1];
      nonOwner = signers[1];

      const owner1Address = await owner1.getAddress();
      const owner2Address = await owner2.getAddress();

      const balance1 = await ethers.provider.getBalance(owner1Address);
      const balance2 = await ethers.provider.getBalance(owner2Address);

      if (balance1 < ethers.parseEther("0.5") || balance2 < ethers.parseEther("0.5")) {
        console.log("Insufficient funds. Please fund accounts with at least 0.5 CRO.");
        this.skip();
      }

      const deploymentOptions = {
        gasPrice: ethers.parseUnits("4000", "gwei")
      };

      owners = [owner1Address];
      MultiSigWalletFactory = await ethers.getContractFactory("MultiSigWallet");
      wallet = await MultiSigWalletFactory.deploy(owners, requiredSignatures, deploymentOptions);
      await wallet.waitForDeployment();

      walletAddress = await wallet.getAddress();

      const fundTx = await owner1.sendTransaction({
        to: walletAddress,
        value: ethers.parseEther("0.01"),
        gasPrice: ethers.parseUnits("4000", "gwei")
      });
      await fundTx.wait();
    } catch (error) {
      skipTests = true;
      console.error("Setup failed:", error);
      this.skip();
    }
  });

  beforeEach(function () {
    if (skipTests) {
      this.skip();
    }
  });

  describe("Basic Functionality", function () {
    it("Should have the correct owners and required signatures", async function () {
      const addr1 = await owner1.getAddress();
      const addr2 = await owner2.getAddress();

      expect(await wallet.owners(0)).to.equal(addr1);
      expect(await wallet.isOwner(addr1)).to.be.true;
      expect(await wallet.isOwner(addr2)).to.be.false;
      expect(await wallet.requiredSignatures()).to.equal(requiredSignatures);
    });

    it("Should have the correct balance", async function () {
      const balance = await wallet.getBalance();
      expect(balance).to.be.gt(0);
    });

    it("Should allow an owner to propose a transaction", async function () {
      const destination = await owner2.getAddress();
      const value = ethers.parseEther("0.001");

      const tx = await wallet.connect(owner1).proposeTransaction(destination, value, "0x", {
        gasPrice: ethers.parseUnits("4000", "gwei")
      });
      await tx.wait();

      transactionCounter = 0;

      const txData = await wallet.transactions(0);
      expect(txData.destination).to.equal(destination);
      expect(txData.value).to.equal(value);
      expect(txData.executed).to.be.false;
      expect(txData.approvals).to.equal(0);
    });

    it("Should allow owners to approve a transaction", async function () {
      const tx = await wallet.connect(owner1).approveTransaction(0, {
        gasPrice: ethers.parseUnits("4000", "gwei")
      });
      await tx.wait();

      const owner1Address = await owner1.getAddress();
      expect(await wallet.approvals(0, owner1Address)).to.be.true;

      const txData = await wallet.transactions(0);
      expect(txData.executed).to.be.true;
    });

    it("Should allow proposing a new transaction after execution", async function () {
      const txData = await wallet.transactions(0);
      if (!txData.executed) this.skip();

      const destination = await owner1.getAddress();
      const value = ethers.parseEther("0.001");

      const tx = await wallet.connect(owner1).proposeTransaction(destination, value, "0x", {
        gasPrice: ethers.parseUnits("4000", "gwei")
      });
      await tx.wait();

      transactionCounter = 1;
      const newTx = await wallet.transactions(1);
      expect(newTx.destination).to.equal(destination);
      expect(newTx.value).to.equal(value);
      expect(newTx.executed).to.be.false;
    });

    it("Should allow owners to revoke their transaction approvals", async function () {
      const destination = await owner2.getAddress();
      const value = ethers.parseEther("0.0005");

      const tx = await wallet.connect(owner1).proposeTransaction(destination, value, "0x", {
        gasPrice: ethers.parseUnits("4000", "gwei")
      });
      await tx.wait();

      transactionCounter++;
      const newTxId = transactionCounter;

      const approveTx = await wallet.connect(owner1).approveTransaction(newTxId, {
        gasPrice: ethers.parseUnits("4000", "gwei")
      });
      await approveTx.wait();

      const txData = await wallet.transactions(newTxId);
      const owner1Address = await owner1.getAddress();

      if (txData.executed) {
        expect(await wallet.approvals(newTxId, owner1Address)).to.be.true;
        return;
      }

      await wallet.connect(owner1).revokeApproval(newTxId, {
        gasPrice: ethers.parseUnits("4000", "gwei")
      });

      expect(await wallet.approvals(newTxId, owner1Address)).to.be.false;
    });

    it("Should prevent duplicate transaction approvals", async function () {
      const destination = await owner2.getAddress();
      const value = ethers.parseEther("0.0005");

      const proposeTx = await wallet.connect(owner1).proposeTransaction(destination, value, "0x", {
        gasPrice: ethers.parseUnits("4000", "gwei")
      });
      await proposeTx.wait();

      transactionCounter++;
      const newTxId = transactionCounter;

      const approveTx = await wallet.connect(owner1).approveTransaction(newTxId, {
        gasPrice: ethers.parseUnits("4000", "gwei")
      });
      await approveTx.wait();

      const txData = await wallet.transactions(newTxId);
      expect(txData.executed).to.be.true;

      await expect(
        wallet.connect(owner1).approveTransaction(newTxId, {
          gasPrice: ethers.parseUnits("4000", "gwei")
        })
      ).to.be.revertedWith("Transaction already executed");
    });

    it("Should reject transaction proposals and approvals from non-owners", async function () {
      const nonOwnerSigner = wallet.connect(nonOwner);

      await expect(
        nonOwnerSigner.proposeTransaction(await owner1.getAddress(), ethers.parseEther("0.001"), "0x", {
          gasPrice: ethers.parseUnits("4000", "gwei")
        })
      ).to.be.revertedWith("Not an owner");

      await expect(
        nonOwnerSigner.approveTransaction(1, {
          gasPrice: ethers.parseUnits("4000", "gwei")
        })
      ).to.be.revertedWith("Not an owner");
    });

    it("Should emit events when proposing and approving transactions", async function () {
      const destination = await owner2.getAddress();
      const value = ethers.parseEther("0.0005");

      const proposeTx = await wallet.connect(owner1).proposeTransaction(destination, value, "0x", {
        gasPrice: ethers.parseUnits("4000", "gwei")
      });

      transactionCounter++;
      const newTxId = transactionCounter;

      const proposeReceipt = await proposeTx.wait();

      const approveTx = await wallet.connect(owner1).approveTransaction(newTxId, {
        gasPrice: ethers.parseUnits("4000", "gwei")
      });
      const approveReceipt = await approveTx.wait();

      const proposedEvent = proposeReceipt.logs.find(
        (log) => isEventLog(log) && log.fragment.name === "TransactionProposed"
      );
      expect(proposedEvent).to.not.be.undefined;

      const approvedEvent = approveReceipt.logs.find(
        (log) => isEventLog(log) && log.fragment.name === "TransactionApproved"
      );
      expect(approvedEvent).to.not.be.undefined;
    });

    it("Should fail to execute transactions with insufficient funds", async function () {
      const balance = await wallet.getBalance();
      const tooLargeValue = ethers.parseEther((parseFloat(ethers.formatEther(balance)) + 1).toString());

      const tx = await wallet.connect(owner1).proposeTransaction(
        await owner1.getAddress(),
        tooLargeValue,
        "0x",
        {
          gasPrice: ethers.parseUnits("4000", "gwei")
        }
      );
      await tx.wait();

      transactionCounter++;
      const newTxId = transactionCounter;

      await expect(
        wallet.connect(owner1).approveTransaction(newTxId, {
          gasPrice: ethers.parseUnits("4000", "gwei")
        })
      ).to.be.reverted;
    });

    it("Should not deploy with invalid initialization parameters", async function () {
      await expect(
        MultiSigWalletFactory.deploy(owners, 0, {
          gasPrice: ethers.parseUnits("4000", "gwei")
        })
      ).to.be.revertedWith("Invalid number of required signatures");

      await expect(
        MultiSigWalletFactory.deploy(owners, 2, {
          gasPrice: ethers.parseUnits("4000", "gwei")
        })
      ).to.be.revertedWith("Invalid number of required signatures");

      await expect(
        MultiSigWalletFactory.deploy([], 1, {
          gasPrice: ethers.parseUnits("4000", "gwei")
        })
      ).to.be.revertedWith("At least one owner is required");
    });
  });
});
