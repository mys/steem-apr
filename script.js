const INITIAL_FETCH_LIMIT = 500;
let [accounts, accountHistory, delegations, dynamicGlobalProperties] = [];
let delegationHistory;
let sbdPrice, steemPrice = 0;

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

	delegationHistory = await buildDelegationHistory(accountHistory, delegations);
	await render(delegationHistory);
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

async function render(delegationHistory){
	_.forOwn(delegationHistory, (delegation, key) => {
		let delegationROI = roi(delegation);
		let table = document.getElementById('myTable').getElementsByTagName('tbody')[0];
		let row = table.insertRow(table.rows.length);
		row.insertCell(row.cells.length).innerHTML = delegation.delegatee;
		row.insertCell(row.cells.length).innerHTML = delegation.steemPower;
		row.insertCell(row.cells.length).innerHTML = delegationROI.earnedSBD;
		row.insertCell(row.cells.length).innerHTML = delegationROI.earnedSteem;
		row.insertCell(row.cells.length).innerHTML = delegation.hasMoreData ? '—' : delegation.startDate.format('MMM Do YYYY');
		row.insertCell(row.cells.length).innerHTML = delegation.hasMoreData ? '—' : delegationROI.daysDelegated;
		row.insertCell(row.cells.length).innerHTML = delegationROI.annualPercentageReturn + '%';
	})
}

function roi(delegation){
	let transfers = delegation.transfers
	let daysDelegated = delegation.endDate.diff(delegation.startDate, 'days') + 1
	let earnedSteem = 0
	let earnedSBD = 0
	let apr = 0
	transfers.forEach((transfer) => {
		let splits = transfer[1].op[1].amount.split(' ', 2)
		if (splits[1] === 'SBD') {
			earnedSBD += Number(splits[0])
		}
		if (splits[1] === 'STEEM') {
			earnedSteem += Number(splits[0])
		}
	})
	let delegatedSP = unitString2Number(delegation.steemPower)
	apr = (((earnedSBD * sbdPrice / steemPrice) + earnedSteem) / daysDelegated) / delegatedSP * 100 * 365
	return {
		earnedSteem: earnedSteem.toFixed(2),
		earnedSBD: earnedSBD.toFixed(2),
		daysDelegated,
		annualPercentageReturn: apr.toFixed(2)
	}
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