'use server';

import { z } from "zod";
import { sql } from '@vercel/postgres';
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { AuthError } from "next-auth";
import { getUser } from "./data";
const bcrypt = require('bcrypt');

async function signUp(formData: FormData) {
    const userName = formData.get('userName');
    const email = formData.get('email');
    const password = formData.get('password');
    const confirmPassword = formData.get('confirmPassword');
    const parsedCredentials = z
        .object({
            userName: z.string().min(3),
            email: z.string().email(),
            password: z.string().min(6),
            confirmPassword: z.string().min(6),
        })
        .refine(() => password === confirmPassword, {
            message: "Passwords don't match"
        })
        .safeParse({ userName, email, password, confirmPassword });
    if (parsedCredentials.success) {

        const userExists = !!await getUser(parsedCredentials.data.email);
        if (userExists) {
            throw new Error('User with this email is already registered')
        } else {
            const parsedUserName = parsedCredentials.data.userName
            const parsedEmail = parsedCredentials.data.email
            const hashedPassword = await bcrypt.hash(parsedCredentials.data.password, 10);

            try {
                await sql`
                    INSERT INTO users (name, email, password)
                    VALUES (${parsedUserName}, ${parsedEmail}, ${hashedPassword})
                `;
            } catch (error) {
                console.error('Database Error:', error);
                throw new Error('something went wrong');
            }
        }
    } else {
        throw new Error(parsedCredentials.error.errors[0].message)
    }
}

export async function register(
    prevState: string | undefined,
    formData: FormData
) {
    try {
        await signUp(formData);
    } catch (error) {
        if (error instanceof Error) {
            return error.message
        }
        return 'Something went wrong'
    }
    await signIn('credentials', formData)
}

export async function authenticate(
    prevState: string | undefined,
    formData: FormData
) {
    try {
        await signIn('credentials', formData);
    } catch (error) {
        if (error instanceof AuthError) {
            switch (error.type) {
                case 'CredentialsSignin':
                    return 'Invalid credentials'
                default:
                    return 'Something went wrong.'
            }
        }
        throw error;
    }
}


const FormSchema = z.object({
    id: z.string(),
    customerId: z.string({
        invalid_type_error: 'Please select a customer.'
    }),
    amount: z.coerce.number()
        .gt(0, { message: 'Please select a number greater than $0.' }),
    status: z.enum(['pending', 'paid'], {
        invalid_type_error: 'Please select an invoice status.'
    }),
    date: z.string(),
})

const CreateInvoice = FormSchema.omit({ id: true, date: true })

export type State = {
    errors?: {
        customerId?: string[];
        amount?: string[];
        status?: string[];
    };
    message?: string | null;
}

export async function createInvoice(prevState: State, formData: FormData) {
    const validatedFields = CreateInvoice.safeParse({
        customerId: formData.get('customerId'),
        amount: formData.get('amount'),
        status: formData.get('status'),
    });

    if (!validatedFields.success) {
        return {
            errors: validatedFields.error.flatten().fieldErrors,
            message: 'Missing Fields. Failed to Create Invoice'
        }
    }

    const { customerId, amount, status } = validatedFields.data;
    const amountInCents = amount * 100;
    const date = new Date().toISOString().split('T')[0];


    try {
        await sql`
        INSERT INTO invoices (customer_id, amount, status, date)
        VALUES (${customerId}, ${amountInCents}, ${status}, ${date})
    `;
    } catch (error) {
        return {
            message: 'Database Error: Failed to Create Invoice'
        }
    }

    revalidatePath('/dashboard/invoices')
    redirect('/dashboard/invoices')
}

const UpdateInvoice = FormSchema.omit({ id: true, date: true })

export async function updateInvoice(id: string, prevState: State, formData: FormData) {
    const validatedFields = UpdateInvoice.safeParse({
        customerId: formData.get('customerId'),
        amount: formData.get('amount'),
        status: formData.get('status'),
    });

    if (!validatedFields.success) {
        return {
            errors: validatedFields.error.flatten().fieldErrors,
            message: 'Missing Fields. Failed to Update Invoice'
        }
    }

    const { customerId, amount, status } = validatedFields.data;
    const amountInCents = amount * 100;

    try {
        await sql`
    UPDATE invoices
    SET customer_id = ${customerId}, amount = ${amountInCents}, status = ${status}
    WHERE id = ${id}
    `;
    } catch (error) {
        return {
            message: 'Database Error, failed to Update Invoice'
        }
    }

    revalidatePath('/dashboard/invoices')
    redirect('/dashboard/invoices')
}


export async function deleteInvoice(id: string) {

    try {
        await sql`DELETE FROM invoices WHERE id = ${id}`;
        revalidatePath('/dashboard/invoices');
        return {
            message: 'Deleted Invoice'
        }
    } catch (error) {
        return {
            message: 'Database Error, failed to Delete Invoice'
        }
    }
}