async function main() {
    // Get the contract factory and signers (accounts)
    const [owner1, owner2] = await ethers.getSigners();
  
    console.log("Deploying MultiSigWallet with the following accounts:");
    console.log("Owner 1:", owner1.address);
    console.log("Owner 2:", owner2.address);
  
    // Set the required number of signatures (2 in this case)
    const requiredSignatures = 2;
  
    // Get the contract factory for MultiSigWallet
    const MultiSigWallet = await ethers.getContractFactory("MultiSigWallet");
  
    console.log("Deploying contract...");
    
    // Deploy the contract and wait for it to be deployed
    const wallet = await MultiSigWallet.deploy(
      [owner1.address, owner2.address],
      requiredSignatures
    );
    
    // Wait for deployment to complete (ethers v6 approach)
    await wallet.waitForDeployment();
    
    // Get the contract address
    const contractAddress = await wallet.getAddress();
    
    console.log("MultiSigWallet deployed to:", contractAddress);
  }
  
  // Run the deployment
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
  