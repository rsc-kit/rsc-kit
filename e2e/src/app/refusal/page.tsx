import { BusyDirect, BusyForm, InvalidAction, InvalidDirect, InvalidForm } from '../../components/BusyForm'

export default function RefusalPage() {
  return (
    <main>
      <h1>Refusal</h1>
      <BusyForm />
      <BusyDirect />
      <InvalidForm />
      <InvalidDirect />
      <InvalidAction />
    </main>
  )
}
