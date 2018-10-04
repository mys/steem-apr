const INITIAL_FETCH_LIMIT = 500;
let [accounts, accountHistory, delegations, dynamicGlobalProperties] = [];
let delegationHistory;

steem.api.setOptions({ url: 'https://api.steemit.com' });
usernameSubmitted();

async function usernameSubmitted(){
    let name = 'wefund';
	[accounts, accountHistory, delegations, dynamicGlobalProperties] = await Promise.all([
		steem.api.getAccountsAsync([name]),
		steem.api.getAccountHistoryAsync(name, -1, INITIAL_FETCH_LIMIT),
		steem.api.getVestingDelegationsAsync(name, -1, 100),
		steem.api.getDynamicGlobalPropertiesAsync()
	]);

	if (!accounts[0]) return
	if (!accountHistory) return
	if (!delegations) return
    if (!dynamicGlobalProperties) return

	accountHistory = accountHistory.reverse()

	let delegationsObj = {}
    delegations.forEach((item) => {
      delegationsObj[`${item.delegator}_${item.delegatee}`] = {
        delegator: item.delegator,
        delegatee: item.delegatee,
        vesting_shares: item.vesting_shares,
        vesting_shares_sp: `${Number.parseFloat(vests2Steem(item.vesting_shares, dynamicGlobalProperties)).toFixed(0)} SP`,
        min_delegation_time: item.min_delegation_time
      }
    })
    delegations = delegationsObj;

	console.log(accounts);
	console.log(accountHistory);
	console.log(delegations);
    console.log(dynamicGlobalProperties);

    delegationHistory = await buildDelegationHistory(accountHistory, delegations);
    console.log(delegationHistory);
}

async function buildDelegationHistory(accountHistory, currentDelegations){
	let delegationHistory = [];

	if (_.isEmpty(accountHistory)) return delegationHistory

	const delegationKeys = Object.keys(currentDelegations)
	const accountHistoryEnd = moment(_.head(accountHistory)[1].timestamp, moment.ISO_8601)
	const accountHistoryStart = moment(_.last(accountHistory)[1].timestamp, moment.ISO_8601)

	_.forOwn(currentDelegations, (delegation) => {
		const { delegator, delegatee, vesting_shares, vesting_shares_sp } = delegation
		delegationHistory[`${delegator}_${delegatee}`] = {
		  delegator,
		  delegatee,
		  vestingShares: vesting_shares,
		  steemPower: vesting_shares_sp,
		  hasMoreData: true,
		  // startDate might be overwritten when we encounter a txType of delegate_vesting_shares
		  startDate: accountHistoryStart,
		  endDate: accountHistoryEnd,
		  transfers: []
		}
	})

	accountHistory.forEach((tx) => {
		const txType = tx[1].op[0]
		const txData = tx[1].op[1]
		if (txType === 'transfer') {
		  const delegationKey = `${txData.to}_${txData.from}`
		  if (delegationKeys.includes(delegationKey)) {
			delegationHistory[delegationKey].transfers.push(tx)
		  }
		} else {
		  // tx is of type TRANSACTION_TYPES.DELEGATE_VESTING_SHARES
		  const delegationKey = `${txData.delegator}_${txData.delegatee}`
		  // Only process current delegations, ignore the rest
		  if (delegationKeys.includes(delegationKey)) {
			// We found when the delegation started, so we overwrite the startDate initialized from accountHistory.
			// This also means we have all data collected for the current delegation.
			delegationHistory[delegationKey].startDate = moment(tx[1].timestamp, moment.ISO_8601)
			// Read all transactions for this delegation, no more data available.
			delegationHistory[delegationKey].hasMoreData = false
			// remove delegation key, because we already collected all transactions from the blockchain
			_.pull(delegationKeys, delegationKey)
		  }
		}
    })

	return delegationHistory
}

function unitString2Number(stringWithUnit){
	return Number(stringWithUnit.split(' ')[0])
}

// vesting_shares is a string with the unit ' VESTS' appended
// delegateVestingShares only accepts 6 decimal digits, therefore we use toFixed(6) for return
function vests2Steem(vestingShares, dynamicGlobalProperties) {
	const { total_vesting_fund_steem, total_vesting_shares } = dynamicGlobalProperties
	const totalVestingFundSteemNumber = unitString2Number(total_vesting_fund_steem)
	const totalVestingSharesNumber = unitString2Number(total_vesting_shares)
	const vestingSharesNumber = unitString2Number(vestingShares)
  
	return (totalVestingFundSteemNumber * (vestingSharesNumber / totalVestingSharesNumber)).toFixed(6)
}