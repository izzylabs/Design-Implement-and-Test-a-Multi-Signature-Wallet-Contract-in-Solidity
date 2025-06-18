// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MultiSigWallet {
    address[] public owners;           // List of owners
    mapping(address => bool) public isOwner; // Mapping to check if an address is an owner
    uint public requiredSignatures;    // Number of signatures required to execute a transaction

    struct Transaction {
        address destination;  // The address to send funds to
        uint value;           // The amount of Ether to send
        bytes data;           // Additional data (e.g., token transfer data)
        bool executed;        // Flag to check if transaction is executed
        uint approvals;       // Number of approvals received
    }

    mapping(uint => Transaction) public transactions; // Mapping from transaction ID to Transaction
    uint public transactionCount; // Counter for transaction IDs

    // Mapping to track which owners have approved a transaction
    mapping(uint => mapping(address => bool)) public approvals;

    // Events
    event TransactionProposed(uint indexed transactionId, address indexed destination, uint value, bytes data);
    event TransactionApproved(uint indexed transactionId, address indexed owner);
    event TransactionExecuted(uint indexed transactionId);
    event TransactionRevoked(uint indexed transactionId, address indexed owner);

    modifier onlyOwner() {
        require(isOwner[msg.sender], "Not an owner");
        _;
    }

    modifier transactionExists(uint _transactionId) {
        require(_transactionId < transactionCount, "Transaction does not exist");
        _;
    }

    modifier notExecuted(uint _transactionId) {
        require(!transactions[_transactionId].executed, "Transaction already executed");
        _;
    }

    constructor(address[] memory _owners, uint _requiredSignatures) {
        require(_owners.length > 0, "At least one owner is required");
        require(_requiredSignatures > 0 && _requiredSignatures <= _owners.length, "Invalid number of required signatures");

        for (uint i = 0; i < _owners.length; i++) {
            address owner = _owners[i];
            require(owner != address(0), "Invalid address");
            require(!isOwner[owner], "Owner already added");
            isOwner[owner] = true;
            owners.push(owner);
        }
        requiredSignatures = _requiredSignatures;
    }

    // Function to propose a transaction (transfer Ether or call contract)
    function proposeTransaction(address _destination, uint _value, bytes memory _data) external onlyOwner {
        uint transactionId = transactionCount++;
        transactions[transactionId] = Transaction({
            destination: _destination,
            value: _value,
            data: _data,
            executed: false,
            approvals: 0
        });
        emit TransactionProposed(transactionId, _destination, _value, _data);
    }

    // Function to approve a proposed transaction
    function approveTransaction(uint _transactionId) external onlyOwner transactionExists(_transactionId) notExecuted(_transactionId) {
        require(!approvals[_transactionId][msg.sender], "Transaction already approved by this owner");

        approvals[_transactionId][msg.sender] = true;
        transactions[_transactionId].approvals++;

        emit TransactionApproved(_transactionId, msg.sender);

        // Execute transaction if required signatures are reached
        if (transactions[_transactionId].approvals >= requiredSignatures) {
            executeTransaction(_transactionId);
        }
    }

    // Function to execute a transaction once the required approvals are met
    function executeTransaction(uint _transactionId) internal transactionExists(_transactionId) notExecuted(_transactionId) {
        Transaction storage txn = transactions[_transactionId];
        require(txn.approvals >= requiredSignatures, "Not enough approvals");


        // Apply checks-effects-interactions pattern:
        txn.executed = true; // Mark the transaction as executed before performing any state-modifying operations
        (bool success, ) = txn.destination.call{value: txn.value}(txn.data);
        require(success, "Transaction execution failed");

        emit TransactionExecuted(_transactionId);
    }

    // Function to revoke an approval for a transaction before it is executed
    function revokeApproval(uint _transactionId) external onlyOwner transactionExists(_transactionId) notExecuted(_transactionId) {
        require(approvals[_transactionId][msg.sender], "Transaction not approved by this owner");

        approvals[_transactionId][msg.sender] = false;
        transactions[_transactionId].approvals--;

        emit TransactionRevoked(_transactionId, msg.sender);
    }

    // Allow the contract to accept Ether directly
    receive() external payable {}

    // Function to check the contract's balance
    function getBalance() external view returns (uint) {
        return address(this).balance;
    }
}
