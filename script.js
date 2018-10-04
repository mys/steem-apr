const INITIAL_FETCH_LIMIT = 500;

steem.api.setOptions({ url: 'https://api.steemit.com' });
usernameSubmitted();

async function usernameSubmitted(){
    let name = 'wefund';
	let [accounts, accountHistory, delegations, dynamicGlobalProperties] = await Promise.all([
		steem.api.getAccountsAsync([name]),
		steem.api.getAccountHistoryAsync(name, -1, INITIAL_FETCH_LIMIT),
		steem.api.getVestingDelegationsAsync(name, -1, 100),
		steem.api.getDynamicGlobalPropertiesAsync()
	]);

	if (!accounts[0]) return
	if (!accountHistory) return
	if (!delegations) return
	if (!dynamicGlobalProperties) return

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