const INITIAL_FETCH_LIMIT = 2000
let [accounts, accountHistory, delegations, dynamicGlobalProperties] = []
let delegationHistory
let sbdPrice, steemPrice = 0

steem.api.setOptions({ url: 'https://api.steemit.com' })
priceHistoryRequest().then(usernameSubmitted)


async function priceHistoryRequest() {
	try {
		// async request of prices here
		let [priceHistorySBD, priceHistorySTEEM] = await Promise.all([
			window.fetch(
			'https://min-api.cryptocompare.com/data/histoday?fsym=SBD*&tsym=USD&limit=14'
			).then(response => response.json()),
			window.fetch(
			'https://min-api.cryptocompare.com/data/histoday?fsym=STEEM&tsym=USD&limit=14'
			).then(response => response.json())
		])

		if (priceHistorySBD.Data.length === 0) return
		priceHistorySBD = priceHistorySBD.Data
		sbdPrice = _.last(priceHistorySBD).close
		//sbdPrice = '0.97'
		document.getElementById('sbdPrice').textContent = 'SBD price: $' + sbdPrice

		if (priceHistorySTEEM.Data.length === 0) return
		priceHistorySTEEM = priceHistorySTEEM.Data
		steemPrice = _.last(priceHistorySTEEM).close
		document.getElementById('steemPrice').textContent = 'STEEM price: $' + steemPrice + ' *'

	} catch (error) {
		console.log(error.message)
	}
}

async function accountHistoryLoadMore(){
	let fetchLimit = INITIAL_FETCH_LIMIT
	let nextSequenceIdToLoad = _.last(accountHistory)[0] - 1

	// If initial load has already loaded the complete history, set status and exit
	if (nextSequenceIdToLoad <= 0) return

	// From must be greater than limit when calling getAccountHistoryAsync(name, from, limit)
	if (nextSequenceIdToLoad <= fetchLimit) {
		fetchLimit = nextSequenceIdToLoad - 1
	}

	let accountHistoryMoreData = await steem.api.getAccountHistoryAsync(accounts[0].name, nextSequenceIdToLoad, fetchLimit)
	accountHistory = accountHistory.concat(accountHistoryMoreData.reverse())

	delegationHistory = await buildDelegationHistory(accountHistory, delegations)
	await render(accountHistory, delegationHistory)
}

async function usernameSubmitted(){
	let name = document.getElementById("searchText").value;
        name = name.toLowerCase();
	[accounts, accountHistory, delegations, dynamicGlobalProperties] = await Promise.all([
		steem.api.getAccountsAsync([name]),
		steem.api.getAccountHistoryAsync(name, -1, INITIAL_FETCH_LIMIT),
		steem.api.getVestingDelegationsAsync(name, -1, 100),
		steem.api.getDynamicGlobalPropertiesAsync()
	])

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
	delegations = delegationsObj

	delegationHistory = await buildDelegationHistory(accountHistory, delegations)
	await render(accountHistory, delegationHistory)
}

async function buildDelegationHistory(accountHistory, currentDelegations){
	let delegationHistory = []

	if (_.isEmpty(accountHistory)) return delegationHistory

	let delegationKeys = Object.keys(currentDelegations)
	let accountHistoryEnd = moment(_.head(accountHistory)[1].timestamp, moment.ISO_8601)
	let accountHistoryStart = moment(_.last(accountHistory)[1].timestamp, moment.ISO_8601)

	_.forOwn(currentDelegations, (delegation) => {
		let { delegator, delegatee, vesting_shares, vesting_shares_sp } = delegation
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
		let txType = tx[1].op[0]
		let txData = tx[1].op[1]
		if (txType === 'transfer') {
		  let delegationKey = `${txData.to}_${txData.from}`
		  if (delegationKeys.includes(delegationKey)) {
			delegationHistory[delegationKey].transfers.push(tx)
		  }
		} else {
		  // tx is of type TRANSACTION_TYPES.DELEGATE_VESTING_SHARES
		  let delegationKey = `${txData.delegator}_${txData.delegatee}`
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

async function render(accountHistory, delegationHistory){
	let accountHistoryDays = 0

	if (_.isEmpty(accountHistory)) {
        document.getElementById('date1').textContent = ''
	  } else {
		let accountHistoryEnd = moment(_.head(accountHistory)[1].timestamp, moment.ISO_8601)
		let accountHistoryStart = moment(_.last(accountHistory)[1].timestamp, moment.ISO_8601)
        document.getElementById('date1').textContent = accountHistoryStart.format('MMMM Do YYYY') + ' - ' + accountHistoryEnd.format('MMMM Do YYYY')
        accountHistoryDays = accountHistoryEnd.diff(accountHistoryStart, 'days') + 1
    }
	document.getElementById('date2').textContent = accountHistoryDays + ' days'

	for (let i = myTable.rows.length - 1; i > 0; i--) {
		myTable.deleteRow(i)
	}

	let topAPRs = [0]
	_.forOwn(delegationHistory, (delegation, key) => {
		let delegationROI = roi(delegation)
		if (parseFloat(delegationROI.annualPercentageReturn) > parseFloat(topAPRs[0])){
			topAPRs.splice(0, 0, delegationROI.annualPercentageReturn)
		}
		else if (parseFloat(delegationROI.annualPercentageReturn) > parseFloat(topAPRs[1])){
			topAPRs.splice(1, 0, delegationROI.annualPercentageReturn)
		}
		else if (parseFloat(delegationROI.annualPercentageReturn) > parseFloat(topAPRs[2])){
			topAPRs.splice(2, 0, delegationROI.annualPercentageReturn)
		}
	})

	_.forOwn(delegationHistory, (delegation) => {
                delegation.roi = roi(delegation)
	})

        let delegationHistoryArray = [];
        delegationHistoryArray = Object.values(delegationHistory);
        delegationHistoryArray.sort(compare).reverse();
        let delegationHistorySorted = Object.assign({}, delegationHistoryArray);

	_.forOwn(delegationHistorySorted, (delegation, key) => {
                let delegationROI = delegation.roi
		let table = document.getElementById('myTable').getElementsByTagName('tbody')[0]
		let row = table.insertRow(table.rows.length)
		row.insertCell(row.cells.length).innerHTML = "<div class='userpic' style='background-image:url(&apos;https://steemitimages.com/u/" + delegation.delegatee + "/avatar&apos;);'></div>" + delegation.delegatee
        row.insertCell(row.cells.length).innerHTML = delegation.steemPower
		row.insertCell(row.cells.length).innerHTML = delegationROI.earnedSBD
		row.insertCell(row.cells.length).innerHTML = delegationROI.earnedSteem
		row.insertCell(row.cells.length).innerHTML = delegation.hasMoreData ? '—' : delegation.startDate.format('MMM Do YYYY')
		row.insertCell(row.cells.length).innerHTML = delegation.hasMoreData ? '—' : delegationROI.daysDelegated
		let innerHtml =
			(delegationROI.annualPercentageReturn == topAPRs[0] ? '<i class="fa fa-trophy fa-2x" style="color:gold"></i> ' :
			delegationROI.annualPercentageReturn == topAPRs[1] ? '<i class="fa fa-trophy fa-2x" style="color:grey"></i> ' :
			delegationROI.annualPercentageReturn == topAPRs[2] ? '<i class="fa fa-trophy fa-2x" style="color:brown"></i> ' : '') +
			delegationROI.annualPercentageReturn + '%'
        row.insertCell(row.cells.length).innerHTML = innerHtml
        row.insertCell(row.cells.length).innerHTML = delegation.hasMoreData ? "<button type='button' class='btn btn-outline-secondary btn-sm load'>Load more</button>" : 'Full'
	})
}

$(document).on('click', 'button.load', function () {
    var $this = $(this)
    var loadingText = '<i class="fa fa-circle-o-notch fa-spin"></i> loading'
    if ($(this).html() !== loadingText) {
		$this.data('original-text', $(this).html())
		$this.html(loadingText)
		accountHistoryLoadMore()
    }
})

$(function(){
	$('.input-group').keypress(function(e){
		if(e.which == 13) usernameSubmitted()
	})
})

function roi(delegation){
	let transfers = delegation.transfers
	let daysDelegated = delegation.endDate.diff(delegation.startDate, 'days') + 1
	let earnedSteem = 0
	let earnedSBD = 0
	let apr = 0
	let transfer_counter = 0
	transfers.forEach((transfer) => {
		//ignore first transfer
		if (transfer_counter > 0) {
			let splits = transfer[1].op[1].amount.split(' ', 2)
				if (splits[1] === 'SBD') {
					earnedSBD += Number(splits[0])
				}
				if (splits[1] === 'STEEM') {
					earnedSteem += Number(splits[0])
				}
		}
		transfer_counter += 1
	})
	let delegatedSP = unitString2Number(delegation.steemPower)
	apr = (((earnedSBD * sbdPrice / steemPrice) + earnedSteem) / daysDelegated) / delegatedSP * 100 * 365
	return {
		earnedSteem: earnedSteem.toFixed(3),
		earnedSBD: earnedSBD.toFixed(3),
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
	let { total_vesting_fund_steem, total_vesting_shares } = dynamicGlobalProperties
	let totalVestingFundSteemNumber = unitString2Number(total_vesting_fund_steem)
	let totalVestingSharesNumber = unitString2Number(total_vesting_shares)
	let vestingSharesNumber = unitString2Number(vestingShares)
  
	return (totalVestingFundSteemNumber * (vestingSharesNumber / totalVestingSharesNumber)).toFixed(6)
}

function compare(a,b) {
  a = parseFloat(a.roi.annualPercentageReturn)
  b = parseFloat(b.roi.annualPercentageReturn)
  if (a < b)
    return -1;
  if (a > b)
    return 1;
  return 0;
}

