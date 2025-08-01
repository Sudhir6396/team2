// stack-recovery.mjs
import { CloudFormationClient, DescribeStacksCommand, DeleteStackCommand, waitUntilStackDeleteComplete } from '@aws-sdk/client-cloudformation';

class CloudFormationRecovery {
    constructor() {
        this.cfClient = new CloudFormationClient({ 
            region: 'ap-south-1',
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
            }
        });
    }

    async checkStackStatus(stackName) {
        try {
            console.log(`🔍 Checking status of stack: ${stackName}`);
            
            const command = new DescribeStacksCommand({
                StackName: stackName
            });
            
            const response = await this.cfClient.send(command);
            const stack = response.Stacks[0];
            
            console.log(`📊 Stack Status: ${stack.StackStatus}`);
            console.log(`📅 Last Updated: ${stack.LastUpdatedTime || stack.CreationTime}`);
            
            if (stack.StackStatusReason) {
                console.log(`💬 Status Reason: ${stack.StackStatusReason}`);
            }
            
            return {
                status: stack.StackStatus,
                reason: stack.StackStatusReason,
                lastUpdated: stack.LastUpdatedTime || stack.CreationTime
            };
            
        } catch (error) {
            if (error.name === 'ValidationError' && error.message.includes('does not exist')) {
                console.log(`✅ Stack ${stackName} does not exist - ready to create`);
                return { status: 'DOES_NOT_EXIST' };
            }
            throw error;
        }
    }

    async waitForRollbackComplete(stackName, maxWaitTime = 30) {
        console.log(`⏳ Waiting for rollback to complete (max ${maxWaitTime} minutes)...`);
        
        const startTime = Date.now();
        const maxWaitMs = maxWaitTime * 60 * 1000;
        
        while (Date.now() - startTime < maxWaitMs) {
            const status = await this.checkStackStatus(stackName);
            
            if (status.status === 'ROLLBACK_COMPLETE' || 
                status.status === 'ROLLBACK_FAILED' ||
                status.status === 'DELETE_FAILED') {
                console.log(`✅ Rollback completed with status: ${status.status}`);
                return status.status;
            }
            
            if (status.status === 'DOES_NOT_EXIST') {
                console.log(`✅ Stack no longer exists`);
                return 'DOES_NOT_EXIST';
            }
            
            console.log(`🔄 Still rolling back... Current status: ${status.status}`);
            await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds
        }
        
        throw new Error(`⏰ Timeout: Rollback did not complete within ${maxWaitTime} minutes`);
    }

    async deleteStack(stackName) {
        try {
            console.log(`🗑️ Deleting stack: ${stackName}`);
            
            const deleteCommand = new DeleteStackCommand({
                StackName: stackName
            });
            
            await this.cfClient.send(deleteCommand);
            console.log(`📤 Delete request sent for stack: ${stackName}`);
            
            // Wait for deletion to complete
            console.log(`⏳ Waiting for stack deletion to complete...`);
            await waitUntilStackDeleteComplete(
                { 
                    client: this.cfClient, 
                    maxWaitTime: 1800, // 30 minutes
                    minDelay: 30,      // 30 seconds between checks
                    maxDelay: 60       // 60 seconds max delay
                },
                { StackName: stackName }
            );
            
            console.log(`✅ Stack ${stackName} deleted successfully`);
            return true;
            
        } catch (error) {
            if (error.name === 'ValidationError' && error.message.includes('does not exist')) {
                console.log(`✅ Stack ${stackName} already deleted`);
                return true;
            }
            throw error;
        }
    }

    async forceDeleteStack(stackName) {
        console.log(`🚨 Force deleting stack: ${stackName}`);
        
        try {
            // First, try normal delete
            await this.deleteStack(stackName);
        } catch (error) {
            console.log(`⚠️ Normal delete failed: ${error.message}`);
            
            // If normal delete fails, you might need to:
            // 1. Delete resources manually via AWS Console
            // 2. Use AWS CLI with --retain-resources flag
            // 3. Contact AWS Support for stuck stacks
            
            console.log(`❌ Manual intervention required:`);
            console.log(`1. Go to AWS Console > CloudFormation`);
            console.log(`2. Select stack: ${stackName}`);
            console.log(`3. Delete with "Retain resources" option if needed`);
            console.log(`4. Or delete individual resources manually`);
            
            return false;
        }
    }

    async recoverStack(stackName) {
        console.log(`🔧 Starting stack recovery for: ${stackName}`);
        
        try {
            // Check current status
            const status = await this.checkStackStatus(stackName);
            
            switch (status.status) {
                case 'DOES_NOT_EXIST':
                    console.log(`✅ Stack ready for deployment`);
                    return true;
                    
                case 'ROLLBACK_IN_PROGRESS':
                    console.log(`⏳ Waiting for rollback to complete...`);
                    const finalStatus = await this.waitForRollbackComplete(stackName);
                    
                    if (finalStatus === 'ROLLBACK_COMPLETE') {
                        console.log(`🗑️ Deleting rolled-back stack...`);
                        return await this.deleteStack(stackName);
                    }
                    return finalStatus === 'DOES_NOT_EXIST';
                    
                case 'ROLLBACK_COMPLETE':
                case 'ROLLBACK_FAILED':
                case 'CREATE_FAILED':
                case 'DELETE_FAILED':
                    console.log(`🗑️ Deleting failed stack...`);
                    return await this.deleteStack(stackName);
                    
                case 'CREATE_COMPLETE':
                case 'UPDATE_COMPLETE':
                    console.log(`✅ Stack is in good state: ${status.status}`);
                    return true;
                    
                default:
                    console.log(`⚠️ Stack in unexpected state: ${status.status}`);
                    console.log(`🤔 Manual review recommended`);
                    return false;
            }
            
        } catch (error) {
            console.error(`❌ Recovery failed:`, error);
            return false;
        }
    }

    async listAllStacks() {
        console.log(`📋 Listing all CloudFormation stacks...`);
        
        try {
            const command = new DescribeStacksCommand({});
            const response = await this.cfClient.send(command);
            
            console.log(`\n📊 Found ${response.Stacks.length} stacks:\n`);
            
            response.Stacks.forEach(stack => {
                console.log(`🏗️ ${stack.StackName}`);
                console.log(`   Status: ${stack.StackStatus}`);
                console.log(`   Created: ${stack.CreationTime}`);
                if (stack.LastUpdatedTime) {
                    console.log(`   Updated: ${stack.LastUpdatedTime}`);
                }
                if (stack.StackStatusReason) {
                    console.log(`   Reason: ${stack.StackStatusReason}`);
                }
                console.log('');
            });
            
        } catch (error) {
            console.error(`❌ Failed to list stacks:`, error);
        }
    }
}

// CLI Usage
async function main() {
    const recovery = new CloudFormationRecovery();
    const stackName = 'safety-alert-audio-cdn';
    
    const args = process.argv.slice(2);
    const command = args[0];
    
    switch (command) {
        case 'status':
            await recovery.checkStackStatus(stackName);
            break;
            
        case 'recover':
            const success = await recovery.recoverStack(stackName);
            if (success) {
                console.log(`\n✅ Stack recovery completed successfully!`);
                console.log(`🚀 You can now redeploy your CDN`);
            } else {
                console.log(`\n❌ Stack recovery failed - manual intervention required`);
            }
            break;
            
        case 'delete':
            await recovery.deleteStack(stackName);
            break;
            
        case 'force-delete':
            await recovery.forceDeleteStack(stackName);
            break;
            
        case 'list':
            await recovery.listAllStacks();
            break;
            
        case 'wait':
            await recovery.waitForRollbackComplete(stackName);
            break;
            
        default:
            console.log(`
🔧 CloudFormation Stack Recovery Tool

Usage:
  node stack-recovery.mjs <command>

Commands:
  status      - Check current stack status
  recover     - Auto-recover stack (recommended)
  delete      - Delete the stack
  force-delete- Force delete with manual steps
  list        - List all stacks
  wait        - Wait for rollback to complete

Examples:
  node stack-recovery.mjs status
  node stack-recovery.mjs recover
  node stack-recovery.mjs delete

Current stack: ${stackName}
            `);
    }
}

// Export for programmatic use
export { CloudFormationRecovery };

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}