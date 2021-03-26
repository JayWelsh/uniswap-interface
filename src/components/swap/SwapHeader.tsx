import React from 'react'
import styled from 'styled-components'
// import Settings from '../Settings'
import { RowBetween } from '../Row'
import { TYPE } from '../../theme'

const StyledSwapHeader = styled.div`
  padding: 12px 1rem 0px 1.5rem;
  margin-bottom: -4px;
  width: 100%;
  max-width: 420px;
  color: ${({ theme }) => theme.text2};
`

interface IProps {
  prefix: string
}

export default function SwapHeader(props: IProps) {
  let { prefix } = props
  return (
    <StyledSwapHeader>
      <RowBetween>
        <TYPE.black fontWeight={500}>{prefix} NFT Swap</TYPE.black>
        {/* <Settings /> */}
      </RowBetween>
    </StyledSwapHeader>
  )
}
