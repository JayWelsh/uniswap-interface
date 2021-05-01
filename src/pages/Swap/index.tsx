import { CurrencyAmount, JSBI, Token, Trade } from '@uniswap/sdk'
import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { RouteComponentProps } from 'react-router-dom'
import { ArrowDown, ArrowUp } from 'react-feather'
import ReactGA from 'react-ga'
import { Text } from 'rebass'
import { ThemeContext } from 'styled-components'
import { TransactionResponse } from '@ethersproject/providers'
import AddressInputPanel from '../../components/AddressInputPanel'
import { ButtonError, ButtonLight, ButtonPrimary, ButtonConfirmed } from '../../components/Button'
import Card, { GreyCard } from '../../components/Card'
import Column, { AutoColumn } from '../../components/Column'
import ConfirmSwapModal from '../../components/swap/ConfirmSwapModal'
import CurrencyInputPanel from '../../components/CurrencyInputPanel'
import { SwapPoolTabs } from '../../components/NavigationTabs'
import { AutoRow, RowBetween } from '../../components/Row'
import AdvancedSwapDetailsDropdown from '../../components/swap/AdvancedSwapDetailsDropdown'
import BetterTradeLink, { DefaultVersionLink } from '../../components/swap/BetterTradeLink'
import confirmPriceImpactWithoutFee from '../../components/swap/confirmPriceImpactWithoutFee'
import { ArrowWrapper, BottomGrouping, SwapCallbackError, Wrapper } from '../../components/swap/styleds'
import TradePrice from '../../components/swap/TradePrice'
import TokenWarningModal from '../../components/TokenWarningModal'
import ProgressSteps from '../../components/ProgressSteps'
import SwapHeader from '../../components/swap/SwapHeader'

import { INITIAL_ALLOWED_SLIPPAGE } from '../../constants'
import { getTradeVersion } from '../../data/V1'
import { useActiveWeb3React } from '../../hooks'
import { useCurrency, useAllTokens } from '../../hooks/Tokens'
import useENSAddress from '../../hooks/useENSAddress'
import { useSwapCallback } from '../../hooks/useSwapCallback'
import useToggledVersion, { DEFAULT_VERSION, Version } from '../../hooks/useToggledVersion'
import useWrapCallback, { WrapType } from '../../hooks/useWrapCallback'
import { useToggleSettingsMenu, useWalletModalToggle } from '../../state/application/hooks'
import { Field } from '../../state/swap/actions'
import {
  useDefaultsFromURLSearch,
  useDerivedSwapInfo,
  useSwapActionHandlers,
  useSwapState
} from '../../state/swap/hooks'
import { useExpertModeManager, useUserSlippageTolerance, useUserSingleHopOnly } from '../../state/user/hooks'
import { LinkStyledButton, TYPE } from '../../theme'
import { maxAmountSpend } from '../../utils/maxAmountSpend'
import { computeTradePriceBreakdown, warningSeverity } from '../../utils/prices'
import AppBody from '../AppBody'
import { ClickableText } from '../Pool/styleds'
import Loader from '../../components/Loader'
import { useIsTransactionUnsupported } from 'hooks/Trades'
import UnsupportedCurrencyFooter from 'components/swap/UnsupportedCurrencyFooter'
import { isTradeBetter } from 'utils/trades'
import { useTokenContractERC1155, useTokenContractERC721, usePopswapContract } from '../../hooks/useContract'
import { POPSWAP_NETWORKS } from '../../constants/popswap'
import { calculateGasMargin } from '../../utils'
import { useTransactionAdder } from '../../state/transactions/hooks'
import { NETWORK_LABELS } from '../../utils'

export default function Swap(props: RouteComponentProps<{ swapId: string }>) {
  const {
    match: {
      params: { swapId }
    },
    history
  } = props

  const loadedUrlParams = useDefaultsFromURLSearch()

  // token warning stuff
  const [loadedInputCurrency, loadedOutputCurrency] = [
    useCurrency(loadedUrlParams?.inputCurrencyId),
    useCurrency(loadedUrlParams?.outputCurrencyId)
  ]
  const [dismissTokenWarning, setDismissTokenWarning] = useState<boolean>(false)
  const urlLoadedTokens: Token[] = useMemo(
    () => [loadedInputCurrency, loadedOutputCurrency]?.filter((c): c is Token => c instanceof Token) ?? [],
    [loadedInputCurrency, loadedOutputCurrency]
  )
  const handleConfirmTokenWarning = useCallback(() => {
    setDismissTokenWarning(true)
  }, [])

  // dismiss warning if all imported tokens are in active lists
  const defaultTokens = useAllTokens()
  const importTokensNotInDefault =
    urlLoadedTokens &&
    urlLoadedTokens.filter((token: Token) => {
      return !Boolean(token.address in defaultTokens)
    })

  const { account, chainId } = useActiveWeb3React()
  const theme = useContext(ThemeContext)

  // toggle wallet when disconnected
  const toggleWalletModal = useWalletModalToggle()

  // for expert mode
  const toggleSettings = useToggleSettingsMenu()
  const [isExpertMode] = useExpertModeManager()

  // get custom setting values for user
  const [allowedSlippage] = useUserSlippageTolerance()

  // swap state
  const { independentField, typedValue, recipient } = useSwapState()

  const [swapClosingMode, setSwapClosingMode] = useState(false)
  
  const [tradeOpeningValue, setTradeOpeningValue] = useState("");
  const [tradeClosingValue, setTradeClosingValue] = useState("");

  const [tradeOpeningTokenAddress, setTradeOpeningTokenAddress] = useState("");
  const [tradeOpeningTokenId, setTradeOpeningTokenId] = useState("");
  const [tradeOpeningTokenType, setTradeOpeningTokenType] = useState("");
  const [tradeOpeningTokenVisual, setTradeOpeningTokenVisual] = useState("");
  const [tradeOpeningTokenVisualFormat, setTradeOpeningTokenVisualFormat] = useState("");
  const [tradeOpeningTokenVisualLoading, setTradeOpeningTokenVisualLoading] = useState(false);
  const [tradeOpeningTokenVisualCannotFind, setTradeOpeningTokenVisualCannotFind] = useState(false);
  const [tradeOpeningVisualKey, setTradeOpeningVisualKey] = useState(0);
  const [tradeOpeningTokenApproving, setTradeOpeningTokenApproving] = useState(false);
  const [tradeOpeningTokenError, setTradeOpeningTokenError] = useState("");

  const [tradeClosingTokenAddress, setTradeClosingTokenAddress] = useState("");
  const [tradeClosingTokenId, setTradeClosingTokenId] = useState("");
  const [tradeClosingTokenType, setTradeClosingTokenType] = useState("");
  const [tradeClosingTokenVisual, setTradeClosingTokenVisual] = useState("");
  const [tradeClosingTokenVisualFormat, setTradeClosingTokenVisualFormat] = useState("");
  const [tradeClosingTokenVisualLoading, setTradeClosingTokenVisualLoading] = useState(false);
  const [tradeClosingTokenVisualCannotFind, setTradeClosingTokenVisualCannotFind] = useState(false);
  const [tradeClosingVisualKey, setTradeClosingVisualKey] = useState(0);
  const [tradeClosingTokenApproving, setTradeClosingTokenApproving] = useState(false);
  const [tradeClosingTokenError, setTradeClosingTokenError] = useState("");

  const [ownsOpeningToken, setOwnsOpeningToken] = useState(false);
  const [openingTokenApproved, setOpeningTokenApproved] = useState(false);

  const [ownsClosingToken, setOwnsClosingToken] = useState(false);
  const [closingTokenApproved, setClosingTokenApproved] = useState(false);

  const [isOpeningTrade, setIsOpeningTrade] = useState(false);
  const [isClosingTrade, setIsClosingTrade] = useState(false);

  const [tradeComplete, setTradeComplete] = useState(false);
  
  const [shareSwapId, setShareSwapId] = useState("");

  const openingTokenERC1155 = useTokenContractERC1155(tradeOpeningTokenAddress)
  const openingTokenERC721 = useTokenContractERC721(tradeOpeningTokenAddress)
  const closingTokenERC1155 = useTokenContractERC1155(tradeClosingTokenAddress)
  const closingTokenERC721 = useTokenContractERC721(tradeClosingTokenAddress)

  const popswapContract = usePopswapContract()

  const addTransaction = useTransactionAdder();

  useEffect(() => {
    let isMounted = true;
    const loadSwapById = async () => {
      if(isMounted) {
        // Fetch swap of ID
        if(popswapContract && chainId && swapId) {
          setSwapClosingMode(true)
          try {
            const loadedSwap = await popswapContract.getTradeByTradeId(swapId)
            if(loadedSwap) {
              let openingLink = `https://opensea.io/assets/${loadedSwap[1]}/${loadedSwap[2]}`
              let closingLink = `https://opensea.io/assets/${loadedSwap[3]}/${loadedSwap[4]}`
              handleInputChange(openingLink)
              handleOutputChange(closingLink)
              if(loadedSwap?.[6].toString() !== "0") {
                setTradeComplete(true)
              }else{
                setTradeComplete(false)
              }
            }
          }catch(e){
            console.log({e})
            // Swap of ID not found
          }
        }else{
          handleInputChange("")
          handleOutputChange("")
          setSwapClosingMode(false)
          setTradeComplete(false)
          setTradeClosingTokenError("")
          setTradeOpeningTokenError("")
          setTradeClosingTokenVisualLoading(false)
          setTradeClosingTokenVisualCannotFind(false)
          setTradeOpeningTokenVisualLoading(false)
          setTradeOpeningTokenVisualCannotFind(false)
        }
      }
    }
    loadSwapById()
    return () =>  { isMounted = false }
  }, [swapId])

  useEffect(() => {
    handleInputChange(tradeOpeningValue)
    handleOutputChange(tradeClosingValue)
  }, [chainId])

  useEffect(() => {
    let isBusy = false;
    let isMounted = true;
    const approveNFT = async () => {
      if(isMounted && !isBusy && tradeClosingTokenAddress && tradeClosingTokenId) {
        isBusy = true

        // const estimatedGas = closingTokenERC1155 && await closingTokenERC1155.estimateGas.balanceOf("0xDE7e3ec4442Ba87247797BEA433985449EDEA893")

        let isErrorERC1155 = false;
        let isErrorERC721 = false;

        let errorMessage = "";

        try {
          let response = closingTokenERC1155 && await closingTokenERC1155.balanceOf(account, tradeClosingTokenId)
          if(response && Number(response) > 0) {
            setOwnsClosingToken(true)
            if(chainId) {
              let isApprovedForAll = closingTokenERC1155 && await closingTokenERC1155.isApprovedForAll(account, POPSWAP_NETWORKS[chainId])
              if(isApprovedForAll) {
                setClosingTokenApproved(true)
              }else{
                setClosingTokenApproved(false)
              }
            }
          }else{
            if(swapClosingMode) {
              errorMessage = "Closing Token Must Be Owned"
            }else{
              errorMessage = ""
            }
            setOwnsClosingToken(false)
          }
        } catch (e) {
          isErrorERC1155 = true
          console.log({e})
        }

        if(isErrorERC1155) {
          try {
            closingTokenERC721 && await closingTokenERC721.balanceOf(account)
            let response = closingTokenERC721 && await closingTokenERC721.ownerOf(tradeClosingTokenId)
            if(response && (account === response)) {
              setOwnsClosingToken(true)
              if(chainId) {
                let tokenOperator = closingTokenERC721 && await closingTokenERC721.getApproved(tradeClosingTokenId)
                if(tokenOperator === POPSWAP_NETWORKS[chainId]) {
                  setClosingTokenApproved(true)
                }else{
                  setClosingTokenApproved(false)
                }
              }
            }else{
              if(swapClosingMode) {
                errorMessage = "Closing Token Must Be Owned"
              }else{
                errorMessage = ""
              }
              setOwnsClosingToken(false)
            }
          }catch(e) {
            setTradeClosingTokenVisual("")
            setTradeClosingTokenVisualFormat("")
            setTradeClosingTokenVisualCannotFind(true)
            isErrorERC721 = true
            console.log({e})
          }
        }

        if(isErrorERC721 && isErrorERC1155 && account) {
          errorMessage = chainId ? `Not Found On Current Network (${NETWORK_LABELS[chainId]})` : `Not Found On Current Network`
        } else if (!account) {
          errorMessage = `Please Connect Wallet First`
        }

        setTradeClosingTokenError(errorMessage)

        let metaResponse;
        try{
          setTradeClosingTokenVisualLoading(true)
          if(!isErrorERC1155) {
            setTradeClosingTokenType("1");
            // Get token IPFS hash
            metaResponse = closingTokenERC1155 && await closingTokenERC1155.uri(tradeClosingTokenId)
          } else if(!isErrorERC721) {
            setTradeClosingTokenType("0");

            // Get token IPFS hash
            metaResponse = closingTokenERC721 && await closingTokenERC721.tokenURI(tradeClosingTokenId)
          }
          if(metaResponse) {
            let ipfsHash = false;
            let openSeaApi = false;
            if(metaResponse && metaResponse.indexOf('ipfs/') > -1) {
              ipfsHash = metaResponse.slice(metaResponse.indexOf('ipfs/') + 5)
            } else if (metaResponse && metaResponse.indexOf('api.opensea.io') > -1) {
              openSeaApi = metaResponse
            }
            if(ipfsHash) {
              let firstIpfsQuery = await fetch(`https://ipfs.io/ipfs/${ipfsHash}`).then(data => data.json())
              if(firstIpfsQuery.image) {
                if(firstIpfsQuery.image.indexOf('ipfs/')) {
                  let secondIpfsHash = firstIpfsQuery.image.slice(firstIpfsQuery.image.indexOf('ipfs/') + 5)
                  let videoCheck = false
                  let response = await fetch(`https://cloudflare-ipfs.com/ipfs/${secondIpfsHash}`)
                  if(!response.ok) {
                    videoCheck = true
                  }
                  setTradeClosingTokenVisual(`https://ipfs.io/ipfs/${secondIpfsHash}`)
                  setTradeClosingVisualKey(tradeClosingVisualKey + 1)
                  if(videoCheck) {
                    setTradeClosingTokenVisualFormat("video")
                  }else{
                    setTradeClosingTokenVisualFormat("image")
                  }
                  setTradeClosingTokenVisualCannotFind(false)
                }
              }else{
                setTradeClosingTokenVisual("")
                setTradeClosingTokenVisualFormat("")
                setTradeClosingTokenVisualCannotFind(true)
              }
            }else if(openSeaApi) {
              let firstOpenSeaApiQuery = await fetch(`https://api.opensea.io/api/v1/metadata/${tradeClosingTokenAddress}/${tradeClosingTokenId}`).then(data => data.json())
              if(firstOpenSeaApiQuery.image) {
                setTradeClosingTokenVisual(firstOpenSeaApiQuery.image)
                setTradeClosingTokenVisualFormat("image")
                setTradeClosingTokenVisualCannotFind(false)
              }else{
                setTradeClosingTokenVisual("")
                setTradeClosingTokenVisualFormat("")
                setTradeClosingTokenVisualCannotFind(true)
              }
            }else{
              throw new Error('No preview detected, use OpenSea fallback')
            }
            setTradeClosingTokenVisualLoading(false)
          }else{
            setTradeClosingTokenVisual("")
            setTradeClosingTokenVisualFormat("")
            setTradeClosingTokenVisualCannotFind(true)
          }
        }catch(e){
          console.log("Falling Back to OpenSea Media", e)
          // Try to load data via OpenSea API
          try {
            let openSeaFallback = await fetch(`https://api.opensea.io/api/v1/metadata/${tradeClosingTokenAddress}/${tradeClosingTokenId}`).then(data => data.json())
            if(openSeaFallback?.image) {
              setTradeClosingTokenVisual(openSeaFallback.image)
              setTradeClosingTokenVisualFormat("image")
              setTradeClosingVisualKey(tradeClosingVisualKey + 1)
              setTradeClosingTokenVisualCannotFind(false)
            }else{
              setTradeClosingTokenVisual("")
              setTradeClosingTokenVisualFormat("")
              setTradeClosingTokenVisualCannotFind(true)
            }
          }catch(e){
            setTradeClosingTokenVisual("")
            setTradeClosingTokenVisualFormat("")
            setTradeClosingTokenVisualCannotFind(true)
          }
        }
        setTradeClosingTokenVisualLoading(false)
      }
    }
    approveNFT();
    return () =>  { isMounted = false }
  }, [closingTokenERC1155, closingTokenERC721, tradeClosingTokenAddress, tradeClosingTokenId, tradeClosingTokenApproving])

  useEffect(() => {
    let isBusy = false;
    let isMounted = true;
    const approveNFT = async () => {
      if(isMounted && !isBusy && tradeOpeningTokenAddress && tradeOpeningTokenId) {
        isBusy = true

        // const estimatedGas = openingTokenERC1155 && await openingTokenERC1155.estimateGas.balanceOf("0xDE7e3ec4442Ba87247797BEA433985449EDEA893")

        let isErrorERC1155 = false;
        let isErrorERC721 = false;

        let errorMessage = "";

        try {
          let response = openingTokenERC1155 && await openingTokenERC1155.balanceOf(account, tradeOpeningTokenId)
          if(response && Number(response) > 0) {
            setOwnsOpeningToken(true)
            if(chainId) {
              let isApprovedForAll = openingTokenERC1155 && await openingTokenERC1155.isApprovedForAll(account, POPSWAP_NETWORKS[chainId])
              if(isApprovedForAll) {
                setOpeningTokenApproved(true)
              }else{
                setOpeningTokenApproved(false)
              }
            }
          }else{
            if(!swapClosingMode) {
              errorMessage = "Opening Token Must Be Owned"
            }else{
              errorMessage = ""
            }
            setOwnsOpeningToken(false)
          }
        } catch (e) {
          isErrorERC1155 = true
          console.log({e})
        }

        if(isErrorERC1155) {
          try {
            openingTokenERC721 && await openingTokenERC721.balanceOf(account)
            let response = openingTokenERC721 && await openingTokenERC721.ownerOf(tradeOpeningTokenId)
            if(response && (account === response)) {
              setOwnsOpeningToken(true)
              if(chainId) {
                let tokenOperator = openingTokenERC721 && await openingTokenERC721.getApproved(tradeOpeningTokenId)
                if(tokenOperator === POPSWAP_NETWORKS[chainId]) {
                  setOpeningTokenApproved(true)
                }else{
                  setOpeningTokenApproved(false)
                }
              }
            }else{
              if(!swapClosingMode) {
                errorMessage = "Opening Token Must Be Owned"
              }else{
                errorMessage = ""
              }
              setOwnsOpeningToken(false)
            }
          }catch(e) {
            setTradeOpeningTokenVisual("")
            setTradeOpeningTokenVisualFormat("")
            setTradeOpeningTokenVisualCannotFind(true)
            isErrorERC721 = true
            console.log({e})
          }
        }

        if(isErrorERC721 && isErrorERC1155 && account) {
          errorMessage = chainId ? `Not Found On Current Network (${NETWORK_LABELS[chainId]})` : `Not Found On Current Network`
        } else if (!account) {
          errorMessage = `Please Connect Wallet First`
        }

        setTradeOpeningTokenError(errorMessage)

        let metaResponse;
        try{
          setTradeOpeningTokenVisualLoading(true)
          if(!isErrorERC1155) {
            setTradeOpeningTokenType("1");
            // Get token IPFS hash
            metaResponse = openingTokenERC1155 && await openingTokenERC1155.uri(tradeOpeningTokenId)
          } else if(!isErrorERC721) {
            setTradeOpeningTokenType("0");

            // Get token IPFS hash
            metaResponse = openingTokenERC721 && await openingTokenERC721.tokenURI(tradeOpeningTokenId)
          }
          if(metaResponse) {
            let ipfsHash = false;
            let openSeaApi = false;
            if(metaResponse && metaResponse.indexOf('ipfs/') > -1) {
              ipfsHash = metaResponse.slice(metaResponse.indexOf('ipfs/') + 5)
            } else if (metaResponse && metaResponse.indexOf('api.opensea.io') > -1) {
              openSeaApi = metaResponse
            }
            if(ipfsHash) {
              let firstIpfsQuery = await fetch(`https://ipfs.io/ipfs/${ipfsHash}`).then(data => data.json())
              if(firstIpfsQuery.image) {
                if(firstIpfsQuery.image.indexOf('ipfs/')) {
                  let secondIpfsHash = firstIpfsQuery.image.slice(firstIpfsQuery.image.indexOf('ipfs/') + 5)
                  let videoCheck = false
                  let response = await fetch(`https://cloudflare-ipfs.com/ipfs/${secondIpfsHash}`)
                  if(!response.ok) {
                    videoCheck = true
                  }
                  setTradeOpeningTokenVisual(`https://ipfs.io/ipfs/${secondIpfsHash}`)
                  setTradeOpeningVisualKey(tradeOpeningVisualKey + 1)
                  if(videoCheck) {
                    setTradeOpeningTokenVisualFormat("video")
                  }else{
                    setTradeOpeningTokenVisualFormat("image")
                  }
                  setTradeOpeningTokenVisualCannotFind(false)
                }
              }else{
                setTradeOpeningTokenVisual("")
                setTradeOpeningTokenVisualFormat("")
                setTradeOpeningTokenVisualCannotFind(true)
              }
            }else if(openSeaApi) {
              let firstOpenSeaApiQuery = await fetch(`https://api.opensea.io/api/v1/metadata/${tradeOpeningTokenAddress}/${tradeOpeningTokenId}`).then(data => data.json())
              if(firstOpenSeaApiQuery?.image) {
                setTradeOpeningTokenVisual(firstOpenSeaApiQuery.image)
                setTradeOpeningTokenVisualFormat("image")
                setTradeOpeningTokenVisualCannotFind(false)
              }else{
                setTradeOpeningTokenVisual("")
                setTradeOpeningTokenVisualFormat("")
                setTradeOpeningTokenVisualCannotFind(true)
              }
            }else{
              setTradeOpeningTokenVisual("")
              setTradeOpeningTokenVisualFormat("")
              setTradeOpeningTokenVisualCannotFind(true)
            }
            setTradeOpeningTokenVisualLoading(false)
          } else {
            setTradeOpeningTokenVisual("")
            setTradeOpeningTokenVisualFormat("")
            setTradeOpeningTokenVisualCannotFind(true)
          }
        }catch(e){
          console.log("Falling Back to OpenSea Media", e)
          // Try to load data via OpenSea API
          let openSeaFallback = await fetch(`https://api.opensea.io/api/v1/metadata/${tradeOpeningTokenAddress}/${tradeOpeningTokenId}`).then(data => data.json())
          if(openSeaFallback?.image) {
            setTradeOpeningTokenVisual(openSeaFallback.image)
            setTradeOpeningTokenVisualFormat("image")
            setTradeOpeningVisualKey(tradeOpeningVisualKey + 1)
            setTradeOpeningTokenVisualCannotFind(false)
          }else{
            setTradeOpeningTokenVisual("")
            setTradeOpeningTokenVisualFormat("")
            setTradeOpeningTokenVisualCannotFind(true)
          }
        }
        setTradeOpeningTokenVisualLoading(false)
      }
    }
    approveNFT();
    return () =>  { isMounted = false }
  }, [openingTokenERC1155, openingTokenERC721, tradeOpeningTokenAddress, tradeOpeningTokenId, tradeOpeningTokenApproving])

  const extractTokenAddressAndId = (value: string, opening: boolean = false) => {
    let returnValue = false;
    if(value && (value.indexOf("0x") > -1)) {
      let simplifiedValue = value.slice(value.indexOf("0x"))
      let splitValues = simplifiedValue.split("/").filter(item => item)
      if(splitValues && splitValues.length == 2) {
        if(opening) {
          setTradeOpeningTokenAddress(splitValues[0])
          setTradeOpeningTokenId(splitValues[1])
        } else {
          setTradeClosingTokenAddress(splitValues[0])
          setTradeClosingTokenId(splitValues[1])
        }
      }else{
        resetOpeningValues()
      }
    }else{
      resetOpeningValues()
    }
    return returnValue;
  }

    const handleInputChange = async (value: string) => {
      extractTokenAddressAndId(value, true)
      setTradeOpeningValue(value)
    }

    const handleOutputChange = async (value: string) => {
      await resetClosingValues();
      extractTokenAddressAndId(value, false)
      setTradeClosingValue(value)
    }

    const resetOpeningValues = async () => {
      setOwnsOpeningToken(false)
      setOpeningTokenApproved(false)
      setTradeOpeningTokenAddress("")
      setTradeOpeningTokenId("")
      setTradeOpeningTokenType("")
      setTradeOpeningTokenVisual("")
      setTradeOpeningTokenVisualFormat("")
      setTradeOpeningTokenError("")
      setShareSwapId("")
      setIsOpeningTrade(false)
    }

    const resetClosingValues = () => {
      setOwnsClosingToken(false)
      setClosingTokenApproved(false)
      setTradeClosingTokenAddress("")
      setTradeClosingTokenId("")
      setTradeClosingTokenType("")
      setTradeClosingTokenVisual("")
      setTradeClosingTokenVisualFormat("")
      setTradeClosingTokenError("")
      setShareSwapId("")
      setIsClosingTrade(false)
    }

    useEffect(() => {
      console.log({tradeOpeningTokenType})
    }, [tradeOpeningTokenType])

    useEffect(() => {
      console.log({tradeClosingTokenType})
    }, [tradeClosingTokenType])

    useEffect(() => {
      console.log({openingTokenApproved})
    }, [openingTokenApproved])

    useEffect(() => {
      console.log({ownsOpeningToken})
    }, [ownsOpeningToken])

  const {
    v1Trade,
    v2Trade,
    currencyBalances,
    parsedAmount,
    currencies,
    inputError: swapInputError,
  } = useDerivedSwapInfo(ownsOpeningToken, openingTokenApproved, Boolean(tradeOpeningTokenAddress && tradeOpeningTokenId), Boolean(tradeClosingTokenAddress && tradeClosingTokenId))
  const { wrapType, execute: onWrap, inputError: wrapInputError } = useWrapCallback(
    currencies[Field.INPUT],
    currencies[Field.OUTPUT],
    typedValue
  )
  const showWrap: boolean = wrapType !== WrapType.NOT_APPLICABLE
  const { address: recipientAddress } = useENSAddress(recipient)
  const toggledVersion = useToggledVersion()
  const tradesByVersion = {
    [Version.v1]: v1Trade,
    [Version.v2]: v2Trade
  }
  const trade = showWrap ? undefined : tradesByVersion[toggledVersion]
  const defaultTrade = showWrap ? undefined : tradesByVersion[DEFAULT_VERSION]

  const betterTradeLinkV2: Version | undefined =
    toggledVersion === Version.v1 && isTradeBetter(v1Trade, v2Trade) ? Version.v2 : undefined

  const parsedAmounts = showWrap
    ? {
        [Field.INPUT]: parsedAmount,
        [Field.OUTPUT]: parsedAmount
      }
    : {
        [Field.INPUT]: independentField === Field.INPUT ? parsedAmount : trade?.inputAmount,
        [Field.OUTPUT]: independentField === Field.OUTPUT ? parsedAmount : trade?.outputAmount
      }

  //@ts-ignore    
  const { onSwitchTokens, onCurrencySelection, onUserInput, onChangeRecipient } = useSwapActionHandlers()
  const isValid = !swapInputError
  // const dependentField: Field = independentField === Field.INPUT ? Field.OUTPUT : Field.INPUT

  // const handleTypeInput = useCallback(
  //   (value: string) => {
  //     onUserInput(Field.INPUT, value)
  //   },
  //   [onUserInput]
  // )
  // const handleTypeOutput = useCallback(
  //   (value: string) => {
  //     onUserInput(Field.OUTPUT, value)
  //   },
  //   [onUserInput]
  // )

  // modal and loading
  const [{ showConfirm, tradeToConfirm, swapErrorMessage, attemptingTxn, txHash }, setSwapState] = useState<{
    showConfirm: boolean
    tradeToConfirm: Trade | undefined
    attemptingTxn: boolean
    swapErrorMessage: string | undefined
    txHash: string | undefined
  }>({
    showConfirm: false,
    tradeToConfirm: undefined,
    attemptingTxn: false,
    swapErrorMessage: undefined,
    txHash: undefined
  })

  // const formattedAmounts = {
  //   [independentField]: typedValue,
  //   [dependentField]: showWrap
  //     ? parsedAmounts[independentField]?.toExact() ?? ''
  //     : parsedAmounts[dependentField]?.toSignificant(6) ?? ''
  // }

  const route = trade?.route
  const userHasSpecifiedInputOutput = Boolean(
    currencies[Field.INPUT] && currencies[Field.OUTPUT] && parsedAmounts[independentField]?.greaterThan(JSBI.BigInt(0))
  )
  const noRoute = !route

  // check whether the user has approved the router on the input token
  //@ts-ignore
  // const [approval, approveCallback] = useApproveCallbackFromTrade(trade, allowedSlippage)

  // check if user has gone through approval process, used to show two step buttons, reset on token change
  // const [approvalSubmitted, setApprovalSubmitted] = useState<boolean>(false)

  // mark when a user has submitted an approval, reset onTokenSelection for input field
  // useEffect(() => {
  //   if (approval === ApprovalState.PENDING) {
  //     setApprovalSubmitted(true)
  //   }
  // }, [approval, approvalSubmitted])

  const maxAmountInput: CurrencyAmount | undefined = maxAmountSpend(currencyBalances[Field.INPUT])
  const atMaxAmountInput = Boolean(maxAmountInput && parsedAmounts[Field.INPUT]?.equalTo(maxAmountInput))

  // the callback to execute the swap
  const { callback: swapCallback, error: swapCallbackError } = useSwapCallback(trade, allowedSlippage, recipient)

  const { priceImpactWithoutFee } = computeTradePriceBreakdown(trade)

  const [singleHopOnly] = useUserSingleHopOnly()

  //@ts-ignore
  const handleSwap = useCallback(() => {
    if (priceImpactWithoutFee && !confirmPriceImpactWithoutFee(priceImpactWithoutFee)) {
      return
    }
    if (!swapCallback) {
      return
    }
    setSwapState({ attemptingTxn: true, tradeToConfirm, showConfirm, swapErrorMessage: undefined, txHash: undefined })
    swapCallback()
      .then(hash => {
        setSwapState({ attemptingTxn: false, tradeToConfirm, showConfirm, swapErrorMessage: undefined, txHash: hash })

        ReactGA.event({
          category: 'Swap',
          action:
            recipient === null
              ? 'Swap w/o Send'
              : (recipientAddress ?? recipient) === account
              ? 'Swap w/o Send + recipient'
              : 'Swap w/ Send',
          label: [
            trade?.inputAmount?.currency?.symbol,
            trade?.outputAmount?.currency?.symbol,
            getTradeVersion(trade)
          ].join('/')
        })

        ReactGA.event({
          category: 'Routing',
          action: singleHopOnly ? 'Swap with multihop disabled' : 'Swap with multihop enabled'
        })
      })
      .catch(error => {
        setSwapState({
          attemptingTxn: false,
          tradeToConfirm,
          showConfirm,
          swapErrorMessage: error.message,
          txHash: undefined
        })
      })
  }, [
    priceImpactWithoutFee,
    swapCallback,
    tradeToConfirm,
    showConfirm,
    recipient,
    recipientAddress,
    account,
    trade,
    singleHopOnly
  ])

  const approveOpeningToken = async () => {
    //@ts-ignore
    let tokenContract
    if(tradeOpeningTokenType === '0') {
      tokenContract = openingTokenERC1155
    }else if(tradeOpeningTokenType === '1') {
      tokenContract = openingTokenERC721
    }
    if(tokenContract && chainId) {
      const estimatedGas = await tokenContract.estimateGas.setApprovalForAll(POPSWAP_NETWORKS[chainId], true)

      await tokenContract.setApprovalForAll(POPSWAP_NETWORKS[chainId], true, {
        gasLimit: calculateGasMargin(estimatedGas)
      })
      .then(async (response: TransactionResponse) => {
        setTradeOpeningTokenApproving(true)
        addTransaction(response, {
          summary: 'Approve Opening NFT',
        })
        await response.wait();
        // Transaction complete, recheck approval status
        setTradeOpeningTokenApproving(false)
      })
      .catch((error: Error) => {
        console.debug('Failed to approve opening NFT', error)
        throw error
      })
    }
  }

  const approveClosingToken = async () => {
    //@ts-ignore
    let tokenContract
    if(tradeClosingTokenType === '0') {
      tokenContract = closingTokenERC1155
    }else if(tradeClosingTokenType === '1') {
      tokenContract = closingTokenERC721
    }
    if(tokenContract && chainId) {
      const estimatedGas = await tokenContract.estimateGas.setApprovalForAll(POPSWAP_NETWORKS[chainId], true)

      await tokenContract.setApprovalForAll(POPSWAP_NETWORKS[chainId], true, {
        gasLimit: calculateGasMargin(estimatedGas)
      })
      .then(async (response: TransactionResponse) => {
        setTradeClosingTokenApproving(true)
        addTransaction(response, {
          summary: 'Approve Closing NFT',
        })
        await response.wait();
        // Transaction complete, recheck approval status
        setTradeClosingTokenApproving(false)
      })
      .catch((error: Error) => {
        console.debug('Failed to approve closing NFT', error)
        throw error
      })
    }
  }

  const openTrade = async () => {
    //@ts-ignore
    if(popswapContract && chainId) {
      let defaultExpiration = Math.floor((new Date().getTime() + (1000 * 60 * 60 * 24 * 7)) / 1000) // ~ 7 days
      // const estimatedGas = await popswapContract.estimateGas.openNewTrade(tradeOpeningTokenAddress, tradeOpeningTokenId, tradeOpeningTokenType, tradeClosingTokenAddress, tradeClosingTokenId, tradeClosingTokenType, defaultExpiration)
      // await popswapContract.openNewTrade(tradeOpeningTokenAddress, tradeOpeningTokenId, tradeOpeningTokenType, tradeClosingTokenAddress, tradeClosingTokenId, tradeClosingTokenType, defaultExpiration, {
      //   gasLimit: calculateGasMargin(estimatedGas)
      // })
      const estimatedGas = await popswapContract.estimateGas.openNewTrade(tradeOpeningTokenAddress, tradeOpeningTokenId, tradeClosingTokenAddress, tradeClosingTokenId, defaultExpiration)
      await popswapContract.openNewTrade(tradeOpeningTokenAddress, tradeOpeningTokenId, tradeClosingTokenAddress, tradeClosingTokenId, defaultExpiration, {
        gasLimit: calculateGasMargin(estimatedGas)
      })
      .then(async (response: TransactionResponse) => {
        setIsOpeningTrade(true)
        addTransaction(response, {
          summary: 'Opening NFT Trade',
        })
        let receipt = await response.wait();
        //@ts-ignore
        let openedSwapId = receipt?.events?.[0]?.args?.tradeId;
        if(openedSwapId){
          setShareSwapId(openedSwapId.toString())
        }else{
          setShareSwapId("")
        }
        setIsOpeningTrade(false)
      })
      .catch((error: Error) => {
        setIsOpeningTrade(false)
        console.debug('Failed to open NFT swap', error)
        throw error
      })
    }
  }

  const closeTrade = async () => {
    //@ts-ignore
    if(popswapContract && chainId) {
      const estimatedGas = await popswapContract.estimateGas.executeTrade(swapId, tradeOpeningTokenType, tradeClosingTokenType)
      await popswapContract.executeTrade(swapId, tradeOpeningTokenType, tradeClosingTokenType, {
        gasLimit: calculateGasMargin(estimatedGas)
      })
      .then(async (response: TransactionResponse) => {
        setIsClosingTrade(true)
        addTransaction(response, {
          summary: 'Trading NFTs',
        })
        let receipt = await response.wait()
        // Transaction complete, redirect to created trade
        console.log("Trade Complete!")
        //@ts-ignore
        let tradeClosed = receipt?.events?.[2]?.args?.tradeId;
        if(tradeClosed) {
          setTradeComplete(true)
        }
        setIsClosingTrade(false)
      })
      .catch((error: Error) => {
        setIsClosingTrade(false)
        console.debug('Failed to complete NFT swap', error)
        throw error
      })
    }
  }

  // const switchOpeningAndClosing = () => {
  //   let useOpeningValue = tradeClosingValue
  //   let useClosingValue = tradeOpeningValue
  //   handleOutputChange(useClosingValue)
  //   handleInputChange(useOpeningValue)
  // }

  // errors
  const [showInverted, setShowInverted] = useState<boolean>(false)

  // warnings on slippage
  const priceImpactSeverity = warningSeverity(priceImpactWithoutFee)

  // show approve flow when: no error on inputs, not approved or pending, or approved in current session
  // never show if price impact is above threshold in non expert mode
  //@ts-ignore
  // const showApproveFlow =
  //   !swapInputError &&
  //   (approval === ApprovalState.NOT_APPROVED ||
  //     approval === ApprovalState.PENDING ||
  //     (approvalSubmitted && approval === ApprovalState.APPROVED)) &&
  //   !(priceImpactSeverity > 3 && !isExpertMode)

  const handleConfirmDismiss = useCallback(() => {
    setSwapState({ showConfirm: false, tradeToConfirm, attemptingTxn, swapErrorMessage, txHash })
    // if there was a tx hash, we want to clear the input
    if (txHash) {
      onUserInput(Field.INPUT, '')
    }
  }, [attemptingTxn, onUserInput, swapErrorMessage, tradeToConfirm, txHash])

  const handleAcceptChanges = useCallback(() => {
    setSwapState({ tradeToConfirm: trade, swapErrorMessage, txHash, attemptingTxn, showConfirm })
  }, [attemptingTxn, showConfirm, swapErrorMessage, trade, txHash])

  const handleMaxInput = useCallback(() => {
    maxAmountInput && onUserInput(Field.INPUT, maxAmountInput.toExact())
  }, [maxAmountInput, onUserInput])

  const handleOutputSelect = useCallback(outputCurrency => onCurrencySelection(Field.OUTPUT, outputCurrency), [
    onCurrencySelection
  ])

  const swapIsUnsupported = useIsTransactionUnsupported(currencies?.INPUT, currencies?.OUTPUT)

  const warningText = () => <p style={{textAlign: 'center', textTransform: 'uppercase'}}><span style={{color: 'red', fontWeight: 'bold'}}>WARNING:</span><br/>Ensure that you trust both OpenSea links<br/>Verify that neither link is a clone or fake<br/>Use at own risk - Contract is unaudited<br/><br/></p>

  return (
    <>
      <TokenWarningModal
        isOpen={importTokensNotInDefault.length > 0 && !dismissTokenWarning}
        tokens={importTokensNotInDefault}
        onConfirm={handleConfirmTokenWarning}
      />
      <SwapPoolTabs active={'swap'} />
      <AppBody style={tradeComplete ? {} : {}}>
        <SwapHeader 
          prefix={swapClosingMode ? "Claim" : "Create"}
          toggleWalletModal={toggleWalletModal}
          account={account}
        />
        <Wrapper id="swap-page">
          <ConfirmSwapModal
            isOpen={showConfirm}
            trade={trade}
            originalTrade={tradeToConfirm}
            onAcceptChanges={handleAcceptChanges}
            attemptingTxn={attemptingTxn}
            txHash={txHash}
            recipient={recipient}
            allowedSlippage={allowedSlippage}
            onConfirm={handleSwap}
            swapErrorMessage={swapErrorMessage}
            onDismiss={handleConfirmDismiss}
          />

          <AutoColumn gap={'md'}>
            <CurrencyInputPanel
              label={independentField === Field.OUTPUT && !showWrap && trade ? 'Opening NFT' : 'Opening NFT'}
              value={tradeOpeningValue}
              showMaxButton={!atMaxAmountInput}
              currency={currencies[Field.INPUT]}
              onUserInput={(value) => handleInputChange(value)}
              onMax={handleMaxInput}
              otherCurrency={currencies[Field.OUTPUT]}
              id="swap-currency-input"
              inputPlaceholder="OpenSea Link (What You Have)"
              disabled={swapClosingMode}
              link={swapClosingMode && tradeOpeningValue ? tradeOpeningValue : undefined}
              error={tradeOpeningTokenError?.length > 0 ? tradeOpeningTokenError : false}
            />
            <div>
              <div style={{width: '150px', height: '150px', marginLeft: 'auto', marginRight: 'auto'}}>
                <div style={{width: '150px', position: 'absolute', height: '150px', marginLeft: 'auto', marginRight: 'auto', display: 'flex', justifyContent: 'center', alignItems: 'center', border: '2px dashed #40444f'}}>
                  {tradeOpeningTokenVisualLoading && <Loader stroke="white" />}
                  {!tradeOpeningTokenVisualLoading && tradeOpeningTokenVisualCannotFind && <span style={{fontSize: 13, opacity: 0.5}}>can't find preview</span>}
                  {!tradeOpeningTokenVisualLoading && tradeOpeningTokenVisual && tradeOpeningTokenVisualFormat === 'image' &&
                    <img style={{maxWidth: '100%', maxHeight: '100%', marginLeft: 'auto', marginRight: 'auto'}} src={tradeOpeningTokenVisual}/>
                  }
                  {!tradeOpeningTokenVisualLoading && tradeOpeningTokenVisual && tradeOpeningTokenVisualFormat === 'video' &&
                    <div style={{height: '100%', width: '100%'}}>
                      <div style={{position: 'absolute', width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center'}}>
                        <Loader stroke="white" />
                      </div>
                      <div style={{position: 'absolute', width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center'}}>
                        <video key={`trade-opening-token-visual-${tradeOpeningVisualKey}`} muted={true} controls={false} autoPlay={true} loop={true} style={{maxWidth: '100%', maxHeight: '200px', marginLeft: 'auto', marginRight: 'auto'}}>
                          <source src={tradeOpeningTokenVisual} type="video/mp4"/>
                        </video>
                      </div>
                    </div>
                  }
                </div>
              </div>
              <AutoColumn justify="space-between">
                <AutoRow justify={isExpertMode ? 'space-between' : 'center'} style={{ padding: '0 1rem', pointerEvents: 'none' }}>
                  <ArrowWrapper clickable>
                    <ArrowDown
                      size="16"
                      onClick={() => {
                        // switchOpeningAndClosing()
                      }}
                      color={currencies[Field.INPUT] && currencies[Field.OUTPUT] ? theme.primary1 : theme.text2}
                    />
                    <ArrowUp
                      size="16"
                      onClick={() => {
                        // switchOpeningAndClosing()
                      }}
                      color={currencies[Field.INPUT] && currencies[Field.OUTPUT] ? theme.primary1 : theme.text2}
                    />
                  </ArrowWrapper>
                  {recipient === null && !showWrap && isExpertMode ? (
                    <LinkStyledButton id="add-recipient-button" onClick={() => onChangeRecipient('')}>
                      + Add a send (optional)
                    </LinkStyledButton>
                  ) : null}
                </AutoRow>
              </AutoColumn>
              <div style={{width: '150px', height: '150px', marginLeft: 'auto', marginRight: 'auto'}}>
                <div style={{width: '150px', position: 'absolute', height: '150px', marginLeft: 'auto', marginRight: 'auto', display: 'flex', justifyContent: 'center', alignItems: 'center', border: '2px dashed #40444f'}}>
                  {tradeClosingTokenVisualLoading && <Loader stroke="white" />}
                  {!tradeClosingTokenVisualLoading && tradeClosingTokenVisualCannotFind && <span style={{fontSize: 13, opacity: 0.5}}>can't find preview</span>}
                  {!tradeClosingTokenVisualLoading && tradeClosingTokenVisual && tradeClosingTokenVisualFormat === 'image' &&
                    <img style={{maxWidth: '100%', maxHeight: '100%', marginLeft: 'auto', marginRight: 'auto'}} src={tradeClosingTokenVisual}/>
                  }
                  {!tradeClosingTokenVisualLoading && tradeClosingTokenVisual && tradeClosingTokenVisualFormat === 'video' &&
                    <div style={{height: '100%', width: '100%'}}>
                      <div style={{position: 'absolute', width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center'}}>
                        <Loader stroke="white" />
                      </div>
                      <div style={{position: 'absolute', width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center'}}>
                        <video key={`trade-closing-token-visual-${tradeClosingVisualKey}`} muted={true} controls={false} autoPlay={true} loop={true} style={{maxWidth: '100%', maxHeight: '100%', marginLeft: 'auto', marginRight: 'auto'}}>
                          <source src={tradeClosingTokenVisual} type="video/mp4"/>
                        </video>
                      </div>
                    </div>
                  }
                </div>
              </div>
            </div>
            <CurrencyInputPanel
              value={tradeClosingValue}
              onUserInput={(value) => handleOutputChange(value)}
              label={independentField === Field.INPUT && !showWrap && trade ? 'Closing NFT' : 'Closing NFT'}
              showMaxButton={false}
              currency={currencies[Field.OUTPUT]}
              onCurrencySelect={handleOutputSelect}
              otherCurrency={currencies[Field.INPUT]}
              id="swap-currency-output"
              inputPlaceholder="OpenSea Link (What You Want)"
              disabled={swapClosingMode}
              link={swapClosingMode && tradeClosingValue ? tradeClosingValue : undefined}
              error={tradeClosingTokenError?.length > 0 ? tradeClosingTokenError : false}
              errorPosition="top"
            />

            {recipient !== null && !showWrap ? (
              <>
                <AutoRow justify="space-between" style={{ padding: '0 1rem' }}>
                  <ArrowWrapper clickable={false}>
                    <ArrowDown size="16" color={theme.text2} />
                  </ArrowWrapper>
                  <LinkStyledButton id="remove-recipient-button" onClick={() => onChangeRecipient(null)}>
                    - Remove send
                  </LinkStyledButton>
                </AutoRow>
                <AddressInputPanel id="recipient" value={recipient} onChange={onChangeRecipient} />
              </>
            ) : null}

            {showWrap ? null : (
              <Card padding={showWrap ? '.25rem 1rem 0 1rem' : '0px'} borderRadius={'20px'}>
                <AutoColumn gap="8px" style={{ padding: '0 16px' }}>
                  {Boolean(trade) && (
                    <RowBetween align="center">
                      <Text fontWeight={500} fontSize={14} color={theme.text2}>
                        Price
                      </Text>
                      <TradePrice
                        price={trade?.executionPrice}
                        showInverted={showInverted}
                        setShowInverted={setShowInverted}
                      />
                    </RowBetween>
                  )}
                  {allowedSlippage !== INITIAL_ALLOWED_SLIPPAGE && (
                    <RowBetween align="center">
                      <ClickableText fontWeight={500} fontSize={14} color={theme.text2} onClick={toggleSettings}>
                        Slippage Tolerance
                      </ClickableText>
                      <ClickableText fontWeight={500} fontSize={14} color={theme.text2} onClick={toggleSettings}>
                        {allowedSlippage / 100}%
                      </ClickableText>
                    </RowBetween>
                  )}
                </AutoColumn>
              </Card>
            )}
          </AutoColumn>
          {!swapClosingMode && 
            <BottomGrouping>
              {warningText()}
              {swapIsUnsupported ? (
                <ButtonPrimary disabled={true}>
                  <TYPE.main mb="4px">Unsupported Asset</TYPE.main>
                </ButtonPrimary>
              ) : !account ? (
                <ButtonLight onClick={toggleWalletModal}>Connect Wallet</ButtonLight>
              ) : showWrap ? (
                <ButtonPrimary disabled={Boolean(wrapInputError)} onClick={onWrap}>
                  {wrapInputError ??
                    (wrapType === WrapType.WRAP ? 'Wrap' : wrapType === WrapType.UNWRAP ? 'Unwrap' : null)}
                </ButtonPrimary>
              ) : noRoute && userHasSpecifiedInputOutput ? (
                <GreyCard style={{ textAlign: 'center' }}>
                  <TYPE.main mb="4px">Insufficient liquidity for this trade.</TYPE.main>
                  {singleHopOnly && <TYPE.main mb="4px">Try enabling multi-hop trades.</TYPE.main>}
                </GreyCard>
              ) : (ownsOpeningToken && shareSwapId.length === 0 && Boolean(tradeOpeningTokenAddress && tradeOpeningTokenId) && Boolean(tradeClosingTokenAddress && tradeClosingTokenId)) ? (
                <RowBetween>
                  <ButtonConfirmed
                    onClick={approveOpeningToken}
                    disabled={openingTokenApproved || tradeOpeningTokenApproving}
                    width="48%"
                    altDisabledStyle={tradeOpeningTokenApproving} // show solid button while waiting
                    confirmed={openingTokenApproved}
                  >
                    {tradeOpeningTokenApproving && !openingTokenApproved ? (
                      <AutoRow gap="6px" justify="center">
                        Approving <Loader stroke="white" />
                      </AutoRow>
                    ) : openingTokenApproved ? (
                      'Approved'
                    ) : (
                      'Approve Opening'
                    )}
                  </ButtonConfirmed>
                  <ButtonError
                    onClick={() => {
                      openTrade()
                    }}
                    width="48%"
                    id="swap-button"
                    disabled={
                      !openingTokenApproved || isOpeningTrade || Boolean(tradeOpeningTokenAddress && tradeOpeningTokenId) === false || Boolean(tradeClosingTokenAddress && tradeClosingTokenId) === false
                    }
                  >
                    {isOpeningTrade ?
                      <AutoRow gap="6px" justify="center">
                        Opening Trade <Loader stroke="white" />
                      </AutoRow> :
                      <Text fontSize={16} fontWeight={500}>
                        Open Trade
                      </Text>
                    }
                  </ButtonError>
                </RowBetween>
              ) : (ownsOpeningToken && shareSwapId.length > 0 && Boolean(tradeOpeningTokenAddress && tradeOpeningTokenId) && Boolean(tradeClosingTokenAddress && tradeClosingTokenId)) ? (
                <>
                  <Column style={{ marginBottom: '1rem' }}>
                    <CurrencyInputPanel
                      value={`${document.location.origin}/#/swap/${shareSwapId}`}
                      onUserInput={() => {}}
                      label={'Trade Sharing Link'}
                      showMaxButton={false}
                      currency={currencies[Field.OUTPUT]}
                      onCurrencySelect={handleOutputSelect}
                      otherCurrency={currencies[Field.INPUT]}
                      id="swap-currency-output"
                      inputPlaceholder="OpenSea Link (What You Want)"
                      disabled={true}
                      link={`/swap/${shareSwapId}`}
                      internalLink={true}
                      error={false}
                      errorPosition="top"
                      copyText={`${document.location.origin}/#/swap/${shareSwapId}`}
                      copyLabel={"Copy Link"}
                      history={history}
                    />
                  </Column>
                  <RowBetween>
                    <ButtonConfirmed
                      disabled={true}
                      width="100%"
                      altDisabledStyle={true} // show solid button while waiting
                      confirmed={true}
                    >
                      Trade Opened
                    </ButtonConfirmed>
                  </RowBetween>
                </>
              ) : (
                <ButtonError
                  onClick={() => {
                    if (isExpertMode) {
                      handleSwap()
                    } else {
                      setSwapState({
                        tradeToConfirm: trade,
                        attemptingTxn: false,
                        swapErrorMessage: undefined,
                        showConfirm: true,
                        txHash: undefined
                      })
                    }
                  }}
                  id="swap-button"
                  disabled={!isValid || (priceImpactSeverity > 3 && !isExpertMode) || !!swapCallbackError}
                  error={isValid && priceImpactSeverity > 2 && !swapCallbackError}
                >
                  <Text fontSize={20} fontWeight={500}>
                    {swapInputError
                      ? swapInputError
                      : priceImpactSeverity > 3 && !isExpertMode
                      ? `Price Impact Too High`
                      : `Swap${priceImpactSeverity > 2 ? ' Anyway' : ''}`}
                  </Text>
                </ButtonError>
              )}
              {isExpertMode && swapErrorMessage ? <SwapCallbackError error={swapErrorMessage} /> : null}
              {betterTradeLinkV2 && !swapIsUnsupported && toggledVersion === Version.v1 ? (
                <BetterTradeLink version={betterTradeLinkV2} />
              ) : toggledVersion !== DEFAULT_VERSION && defaultTrade ? (
                <DefaultVersionLink />
              ) : null}
              {ownsOpeningToken && shareSwapId.length === 0 && tradeOpeningTokenAddress && tradeOpeningTokenId && tradeClosingTokenAddress && tradeClosingTokenId && (
                <Column style={{ marginTop: '1rem' }}>
                  <ProgressSteps steps={[openingTokenApproved]} />
                </Column>
              )}
            </BottomGrouping>
          }
          {swapClosingMode && 
            <BottomGrouping>
              {warningText()}
              <RowBetween>
                {ownsClosingToken && !tradeComplete && 
                  <ButtonConfirmed
                        onClick={approveClosingToken}
                        disabled={closingTokenApproved || tradeClosingTokenApproving}
                        width={"48%"}
                        altDisabledStyle={tradeClosingTokenApproving} // show solid button while waiting
                        confirmed={closingTokenApproved}
                      >
                      {tradeClosingTokenApproving && !closingTokenApproved ? (
                        <AutoRow gap="6px" justify="center">
                          Approving <Loader stroke="white" />
                        </AutoRow>
                      ) : closingTokenApproved ? (
                        'Approved'
                      ) : (
                        'Approve Closing'
                      )}
                  </ButtonConfirmed>
                }
                {!tradeComplete && !isClosingTrade &&
                  <ButtonError
                    onClick={() => {
                      closeTrade()
                    }}
                    id="swap-button"
                    disabled={
                      !closingTokenApproved || !ownsClosingToken || Boolean(tradeOpeningTokenAddress && tradeOpeningTokenId) === false || Boolean(tradeClosingTokenAddress && tradeClosingTokenId) === false
                    }
                    width={ownsClosingToken ? '48%' : '100%'}
                  >
                    <Text fontSize={16} fontWeight={500}>
                      {ownsClosingToken && closingTokenApproved
                        ? `Trade NFTs`
                        : !ownsClosingToken 
                          ? `Closing NFT Must Be Owned To Trade`
                          : `Trade NFTs`
                      }
                    </Text>
                  </ButtonError>
                }
                {isClosingTrade && 
                  <ButtonError
                    id="swap-button"
                    disabled={true}
                    width={'48%'}
                  >
                  <AutoRow gap="6px" justify="center">
                    Trading NFTs <Loader stroke="white" />
                  </AutoRow>
                </ButtonError>
                }
                {tradeComplete &&
                  <ButtonConfirmed
                    disabled={tradeComplete}
                    width={'100%'}
                    altDisabledStyle={true}
                    confirmed={true}
                  >
                    Trade Successful
                  </ButtonConfirmed>
                }
              </RowBetween>
              {ownsClosingToken && !tradeComplete && (
                <Column style={{ marginTop: '1rem' }}>
                  <ProgressSteps steps={[closingTokenApproved]} />
                </Column>
              )}
            </BottomGrouping>
          }
        </Wrapper>
      </AppBody>
      {!swapIsUnsupported ? (
        <AdvancedSwapDetailsDropdown trade={trade} />
      ) : (
        <UnsupportedCurrencyFooter show={swapIsUnsupported} currencies={[currencies.INPUT, currencies.OUTPUT]} />
      )}
    </>
  )
}
